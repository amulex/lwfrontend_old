import {Connection, Session, StreamEvent} from "openvidu-browser";
import {onSignal, OnSignal_Session, signal, Signal_Session} from "../../openvidu/signal";
import {Answer, Offer, PredefinedPeerConfig} from "../../openvidu/peer";
import {WebRtcPeer} from "openvidu-browser/lib/OpenViduInternal/WebRtcPeer/WebRtcPeer";
import {assert, combineProcedures, Fetch, HandleMessage, jsonParseDefault, log, MimeType, noop, size as objectSize, FileHelper, WebRtcHelper} from "@devlegal/shared-ts";
import {HandleRecvMessage, ReceiveMessageSystem, SendMessage, Transport} from "./transports";
import {ConnectionId} from "../../openvidu/openvidu";
import {logMessage, MessageType} from "../../backend";
import {Stream} from "../shared";

export type FileMessage = SendMessage & { file: File };
export type FileTransport = Transport<FileMessage>;
export type HandleFile = HandleRecvMessage<FileMessage>;

type FileMetadata = {
    name: string,
    type: MimeType,
    size: number,
    time: Date,
    system: ReceiveMessageSystem
};

/**
 * Implementation based on WebRTC data channels, sends/receives files p2p.
 *
 * Uses Session.signal method for signaling.
 */
export class DataChannelTransport implements FileTransport {
    private dataChannels: { [connectionId: string]: RTCDataChannel } = {};
    private peers: { [connectionId: string]: WebRtcPeer } = {};
    private signal: Signal_Session;
    private onSignal: OnSignal_Session;
    private peerConfig: PredefinedPeerConfig;
    private onMessage: HandleMessage = noop;
    /**
     * Queue need to don't break the file transfer order.
     */
    private messageQueue: FileMessage[] = [];
    private queueInProcess: boolean = false;

    constructor(private session: Session, private fetch: Fetch) {
        this.signal = signal(session);
        this.onSignal = onSignal(session);
        this.peerConfig = {
            mode: 'sendrecv',
            mediaConstraints: {video: false, audio: false},
            simulcast: false,
            iceServers: undefined,
            mediaStream: new MediaStream() // Must be specified to onicecandidate will be fired
        };

        this.negotiateDataChannels(session);
    }

    public send = (message: FileMessage): Promise<void> => {
        log('File added to queue:', message.file);
        this.messageQueue.push(message);
        return this.processQueue();
    };

    public onReceived = (handle: HandleFile): void => {
        let metadata: FileMetadata | undefined;
        let buffers: ArrayBuffer[] = [];

        const hdl = ({data}: MessageEvent) => {
            if (typeof data === 'string') {
                metadata = jsonParseDefault(data);
                buffers = [];
                return;
            }

            buffers.push(data);
            const {name, type, size, time, system} = metadata!;
            const currentSize = FileHelper.totalSize(buffers);
            handleSizeOverflow(metadata!, currentSize);

            if (currentSize === size) {
                const file = new File(buffers, name, {type});
                handle({
                    custom: {file, time},
                    system
                });
                buffers = [];
                metadata = undefined;
            }
        };

        this.addMessageHandler(hdl);
    };

    /**
     * Sends all messages from queue.
     *
     * Messages will accumulate if not all channel are negotiaged or if queue is processing at that time.
     * For that reason queue is processed after channel initializing in {@see initDataChannel}.
     */
    private processQueue = async (): Promise<void> => {
        if (this.queueInProcess || !this.messageQueue.length || !this.allChannelsNegotiated()) {
            return;
        }

        this.queueInProcess = true;
        log('Processing file queue...');

        let message;
        while (message = this.messageQueue.shift()) {
            await this.sendFile(message);
        }

        this.queueInProcess = false;
    };

    private sendFile = async ({file, time}: FileMessage): Promise<void> => {
        const metadata = createFileMetadata(file, time, {
            from: this.session.connection.connectionId,
            stream: Stream.Subscriber
        });

        for (const channel of Object.values(this.dataChannels)) {
            WebRtcHelper.sendNowOrOnOpen(channel, JSON.stringify(metadata) as any);

            // 16 KiB is safe chunk size: https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html
            const buffers = FileHelper.toChunks(file, 16 * 1024).map(FileHelper.toArrayBuffer);
            for (const buffer of buffers) {
                WebRtcHelper.sendNowOrOnOpen(channel, await buffer as any);
            }
            log('File sent:', file.name);

            const {name, type, size} = metadata;
            await logMessage({
                type: MessageType.File,
                typeRelated: {name, type, size},
                time,
                connection: this.session.connection.connectionId,
            }, this.fetch);
        }
    };

    private addMessageHandler = (handle: HandleMessage): void => {
        this.onMessage = combineProcedures(this.onMessage, handle);

        for (const channel of Object.values(this.dataChannels)) {
            channel.onmessage = this.onMessage;
        }
    };

    private negotiateDataChannels = (session: Session): void => {
        session.on('streamCreated', async (event) => {
            log('Stream created, start offer sending');
            const connection = (event as StreamEvent).stream.connection;
            const offer = new Offer(this.signal(connection), this.onSignal(connection));

            const peer = offer.createOfferer(this.peerConfig);
            this.peers[connection.connectionId] = peer;
            const channel = peer.pc.createDataChannel('fileSending');
            await this.initDataChannel(channel, connection);
            return offer.sendOffer(peer);
        });

        const answer = new Answer(this.signal, this.onSignal());
        answer.onOffer(this.peerConfig, (peer, from) => {
            this.peers[from.connectionId] = peer;
            peer.pc.ondatachannel = ({channel}: RTCDataChannelEvent) => this.initDataChannel(channel, from);
        });

        session.on('streamDestroyed', (event) => {
            const connection = (event as StreamEvent).stream.connection;
            this.closeRtcConnections(connection.connectionId);
        });

        session.on('sessionDisconnected', () => {
            for (const id of Object.keys(this.dataChannels)) {
                this.closeRtcConnections(id);
            }

            assert(objectSize(this.peers) === 0, 'All peers must be cleared in closeRtcConnections');
        });
    };

    private allChannelsNegotiated = (): boolean => {
        return this.session.streamManagers.length - 1 === objectSize(this.peers)
            && this.session.streamManagers.length - 1 === objectSize(this.dataChannels);
    };

    private initDataChannel = (channel: RTCDataChannel, from: Connection): Promise<void> => {
        log('Data channnel created:', channel);
        channel.binaryType = 'arraybuffer';
        channel.onerror = console.log;
        channel.onmessage = this.onMessage;
        window.addEventListener('beforeunload', () => channel.close());
        this.dataChannels[from.connectionId] = channel;
        return this.processQueue();
    };

    private closeRtcConnections = (id: ConnectionId): void => {
        this.dataChannels[id].close();
        delete this.dataChannels[id];
        log('Data channel deleted:', id);

        this.peers[id].pc.close();
        delete this.peers[id];
        log('WebRTC peer deleted:', id);
    };
}

const createFileMetadata = (file: File, time: Date, system: ReceiveMessageSystem): FileMetadata => {
    const {name, type, size} = file;
    return {name, type, size, time, system};
};

const handleSizeOverflow = (metadata: FileMetadata, chunksSize: number): void => {
    if (chunksSize > metadata.size) {
        log(`File ${metadata.name} size overflow: chunks size ${chunksSize} more then file size ${metadata.size}.`);
    }
};
