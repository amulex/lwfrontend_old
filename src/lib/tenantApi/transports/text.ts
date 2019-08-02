import {Session} from "openvidu-browser";
import {Fetch} from "@devlegal/shared-ts";
import {onSignal, signal} from "../../openvidu/signal";
import {HandleRecvMessage, RecvMessage, SendMessage, Transport} from "./transports";
import {logMessage, MessageType} from "../../backend";
import {Stream} from "../shared";

export type TextMessage = SendMessage & { text: string };
export type TextTransport = Transport<TextMessage>;
type ReceiveTextMessage = RecvMessage<TextMessage>;
export type HandleText = HandleRecvMessage<TextMessage>;

/**
 * Implementation based on Session.signal method.
 */
export class SignalTextTransport implements TextTransport {
    constructor(private session: Session, private fetch: Fetch) {
    }

    public send = async ({text, time}: TextMessage): Promise<any> => {
        const connectionId = this.session.connection.connectionId;
        const message: ReceiveTextMessage = {
            custom: {text, time},
            system: {from: connectionId, stream: Stream.Subscriber}
        };

        await signal(this.session)()('text', message);

        return logMessage({
            type: MessageType.Text,
            typeRelated: {text},
            time,
            connection: connectionId,
        }, this.fetch);
    };

    public onReceived = (handle: HandleText): void => {
        onSignal(this.session)('notOwn')('text', ({data}) => handle(data as ReceiveTextMessage));
    };
}
