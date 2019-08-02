import {CallSignals} from "../callSignals";
import {ConnectOptions} from "@devlegal/shared-ts";
import {PublishersConnectSession} from "../../openvidu/openvidu";
import {getMetadata, HandleMetadata, ParticipantType} from "../shared";
import {Connection, Publisher, PublisherProperties, Session, StreamEvent} from "openvidu-browser";
import {Profile, Tenant} from "../../backend";

export class LiveWidgetApi {

    protected activePublisher?: Publisher;
    private participantLeftHandlers: Array<{type: ParticipantType | 'all', handle: HandleMetadata}> = [];

    protected constructor (protected profile: Profile,
                           protected connector: PublishersConnectSession,
                           protected options: ConnectOptions,
                           protected signals: CallSignals,
                           private aWindow: Window = window) {
        aWindow.addEventListener('unload', () => this.disconnect());
    }

    public onParticipantLeft(type: ParticipantType | 'all', handle: HandleMetadata) {
        this.participantLeftHandlers.push({type, handle});
    };

    public async disconnect(): Promise<void> {
        await this.leave();
        return this.signals.disconnect();
    }

    public async leave(): Promise<void> {
        if (this.activeSession) {
            await this.signals.leave(this.activeSession);
            await this.activeSession.unpublish(this.activePublisher!);
            await this.activeSession.disconnect();
            this.activePublisher = undefined;
        }
    }

    public get sessionId(): string | undefined {
        return this.activeSession ? this.activeSession.sessionId : undefined;
    }

    public get hasActiveSession(): boolean {
        return this.sessionId !== undefined;
    }

    public get tenant(): Tenant {
        return this.signals.tenant;
    }

    protected async connect(options: ConnectOptions = this.options, publisherProperties?: PublisherProperties): Promise<void> {
        this.activePublisher = await this.connector(options, publisherProperties);
        if (!this.activeSession) {
            throw new Error('Error creating Openvidu session');
        }

        const handleParticipantLeft = (connection: Connection) => {
            this.participantLeftHandlers.forEach(handler => {
                const metadata = getMetadata(connection);
                if (handler.type === 'all' || metadata.system.type === handler.type) {
                    // prevent sending to oneself
                    if (metadata.system.profile.email !== this.profile.email) {
                        handler.handle(metadata, connection);
                    }
                }
            });
        };

        this.activeSession.on('sessionDisconnected', (event) => handleParticipantLeft((event.target as Session).connection));
        this.activeSession.on('streamDestroyed', (event) => handleParticipantLeft((event as StreamEvent).stream.connection));

    }

    protected get activeSession(): Session | undefined {
        return this.activePublisher ? this.activePublisher.session : undefined;
    }
}