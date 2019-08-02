import {ConnectOptions, FailedFetch} from "@devlegal/shared-ts";
import {PublisherProperties} from "openvidu-browser";
import {LiveWidgetApi} from "./LiveWidgetApi";
import {PublishersConnectSession, SessionId} from "../../openvidu/openvidu";
import {ClientSignals} from "../callSignals";
import {Profile} from "../../backend";

/**
 * API for client of tenant that needs in consulting.
 *
 * ClientApi creates a new session to which can connect several consultants (answer the call).
 */
export class ClientApi extends LiveWidgetApi {
    /**
     * Use {@see createParticipant} to instantiate it.
     *
     * @hidden
     */
    constructor(protected profile: Profile,
                protected connector: PublishersConnectSession,
                protected options: ConnectOptions,
                protected signals: ClientSignals) {
        super(profile, connector, options, signals);
    }

    /**
     * Performs call from client and sends signal to consultants of same tenant about it, to they can serve this call.
     *
     * @throws OVPublisherError
     */
    public async call(customProperties: PublisherProperties = {}): Promise<SessionId> {
        try {
            await this.connect(this.options, customProperties);
            await this.signals.call(this.activeSession!);
            return this.activeSession!.sessionId;
        }
        catch (error) {
            if (error instanceof FailedFetch && error.response.status === 400) {
                const errorData = await error.response.json();
                console.error(`LiveWidget error: ${errorData.error}`);
            }
            throw error;
        }
    };

    public callAudio(): Promise<SessionId> {
        return this.call({videoSource: false});
    }
}
