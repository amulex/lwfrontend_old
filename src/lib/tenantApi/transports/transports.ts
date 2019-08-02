import {Fetch, MaybePromiseVoid} from "@devlegal/shared-ts";
import {DataChannelTransport, FileMessage, FileTransport} from "./file";
import {ConnectionId, HandleSession} from "../../openvidu/openvidu";
import {SignalTextTransport, TextMessage, TextTransport} from "./text";
import {Stream} from "../shared";
import {Session} from "openvidu-browser";

export type SendMessage = {
    time: Date
};
/**
 * Transport is abstract messenger, can send/receive messages of generic type.
 */
export type Transport<M> = {
    /**
     * Sends message to all participants of the session.
     */
    send: HandleMessage<M>;
    /**
     * Calls handlers on text message receiving from any participant of the session.
     */
    onReceived(handle: HandleRecvMessage<M>): void;
};
type HandleMessage<M> = (message: M) => MaybePromiseVoid;
export type ReceiveMessageSystem = {
    from: ConnectionId,
    stream: Stream
};
export type RecvMessage<M> = {
    custom: M,
    system: ReceiveMessageSystem
};
export type HandleRecvMessage<M> = HandleMessage<RecvMessage<M>>;

/**
 * Agent can perform some actions with transports (right after its instantiating).
 */
export type TextTransportAgent = (t: TextTransport) => void;
export type FileTransportAgent = (f: FileTransport) => void;

export const bindTransportAgentsFactory = (fetch: Fetch, textAgent: TextTransportAgent, fileAgent: FileTransportAgent): HandleSession =>
    (session) => {
        const text = new CompositeTransport<TextMessage>([
            new SignalTextTransport(session, fetch),
            new OwnMessagesRepeater(session)
        ]);
        const file = new CompositeTransport<FileMessage>([
            new DataChannelTransport(session, fetch),
            new OwnMessagesRepeater(session)
        ]);

        textAgent(text);
        fileAgent(file);
    };

/**
 * Adds own sent messages receiving.
 */
export class OwnMessagesRepeater<M> implements Transport<M> {
    private handlers: Array<HandleRecvMessage<M>> = [];

    constructor(private session: Session) {
    }

    public send = (custom: M) => {
        const message = {
            custom,
            system: {
                from: this.session.connection.connectionId,
                stream: Stream.Publisher
            }
        };
        this.handlers.forEach(handler => handler(message));
    };

    public onReceived = (handle: HandleRecvMessage<M>) => {
        this.handlers.push(handle);
    };
}

/**
 * Combines several transports that behaves as the only.
 */
export class CompositeTransport<M> implements Transport<M> {
    constructor(private transports: Array<Transport<M>>) {
    }

    public send = (message: M) =>
        Promise.all(this.transports.map((transport) => transport.send(message)));

    public onReceived = (handle: HandleRecvMessage<M>) =>
        this.transports.forEach(transport => transport.onReceived(handle));
}
