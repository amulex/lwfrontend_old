import {ConnectSession, getAllConnections} from "../openvidu/openvidu";
import {Session, SignalEvent} from "openvidu-browser";
import {
    decorateFirstArg,
    DeepReadonly,
    Fetch,
    jsonParseDefault,
    lazyAsync,
    MaybePromiseVoid,
    OpenViduRole
} from "@devlegal/shared-ts";
import {isConsultantRole, ParticipantMetadata} from "./shared";
import {filterParticipantsByRole, Profile, Tenant} from "../backend";
import underscore from "underscore";

/**
 * Repeats structure of {@see Session}.
 */
type SessionInfo = DeepReadonly<{
    sessionId: string,
    connection: {
        stream: {
            hasAudio: boolean,
            hasVideo: boolean,
        }
    }
}>;

export type SessionParticipant = DeepReadonly<{
    session: SessionInfo,
    participant: ParticipantMetadata
}>;

type HandleSessionParticipant = (p: SessionParticipant) => MaybePromiseVoid;

enum CallSignalTypes {
    Call = 'call:call',
    Answer = 'call:answer',
    Leave = 'call:leave',
    MaxParticipants = 'call:maxParticipants'
}

/**
 * Only particpants of same tenant can send/recieve signals to each other.
 * All signals (events) are fired in session with name equal tenant key of participant.
 * These are system sessions without audio/video calls, only with system signals.
 * All signal can be listened only by consultants to prevent vulnerabilities from anonymous user.
 */
export abstract class CallSignals {
    constructor(private connect: ConnectSession,
                private profile: Profile,
                public tenant: Tenant,
                protected metadata: ParticipantMetadata,
                private fetch: Fetch) {
    }

    protected signalParticipant = (type: string) => async (info: SessionInfo): Promise<void> => {
        const metadata: SessionParticipant = {
            session: extractSessionInfo(info),
            participant: this.metadata
        };
        const data = JSON.stringify(metadata);

        const notifySession = await this.getSession();
        const connections = getAllConnections(notifySession);

        // There is one issue here: in window.unload we have to leave all sessions.
        // When we try to send signal LEAVE to bus, this code tries to get all participant's roles to send signal only to consultants.
        // If some of them are not cached code will try to get it from backend.
        // BUT! In unload handler all ajax request seems to be cancelled.
        // So, for now seems like all participant's roles (but me) are cached BEFORE we can send leave signal, and now all is ok,
        // but this place can be problem in further.

        const allButMeConnections = connections.filter(c => c.connectionId !== notifySession.connection.connectionId);
        const consultants = await filterParticipantsByRole(allButMeConnections, isConsultantRole, this.fetch);
        // const consultants = await filterParticipantsByRole(connections, isConsultantRole, this.fetch);

        if (consultants.length) {
            return notifySession.signal({type, data, to: consultants});
        }
    };

    protected onParticipant = (type: string) => async (handle: HandleSessionParticipant): Promise<void> => {
        const session = await this.getSession();
        session.on(`signal:${type}`, (event) => {
            const data = ((event as SignalEvent).data);
            const participant = jsonParseDefault(data);
            handle(participant);
        });
    };

    private getSession = lazyAsync(async (): Promise<Session> => {
        const options = {
            session: {customSessionId: this.tenant.key},
            token: {role: OpenViduRole.SUBSCRIBER}
        };

        return await this.connect(options);
    });

    public async disconnect(): Promise<void> {
        const session = await this.getSession();
        return session.disconnect();
    }

    public leave = this.signalParticipant(CallSignalTypes.Leave);
    public maxParticipants = this.signalParticipant(CallSignalTypes.MaxParticipants);
}

export class ClientSignals extends CallSignals {
    public call = this.signalParticipant(CallSignalTypes.Call);
}

export class ConsultantSignals extends CallSignals {
    public answer = this.signalParticipant(CallSignalTypes.Answer);
    public onAnswered = this.onParticipant(CallSignalTypes.Answer);
    public onCall = this.onParticipant(CallSignalTypes.Call);
    // not in communication
    public onLeft = this.onParticipant(CallSignalTypes.Leave);
    public onFirstMaxParticipants = decorateFirstArg(this.onParticipant(CallSignalTypes.MaxParticipants), underscore.once);
}

/**
 * From whole session object, for example.
 */
const extractSessionInfo = (session: SessionInfo): SessionInfo => ({
    sessionId: session.sessionId,
    connection: {
        stream: {
            hasAudio: session.connection.stream.hasAudio,
            hasVideo: session.connection.stream.hasVideo,
        }
    }
});
