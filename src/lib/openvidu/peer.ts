import {Connection} from "openvidu-browser";
import {WebRtcPeer, WebRtcPeerConfiguration} from "openvidu-browser/lib/OpenViduInternal/WebRtcPeer/WebRtcPeer";
import {log, MaybePromiseVoid, shallowMerge, Without} from "@devlegal/shared-ts";
import {OnSignal_SessionFrom, Signal_Session, Signal_SessionTo} from "./signal";

enum IceSignals {
    Offer = 'webrtc:offer',
    Answer = 'webrtc:answer',
    Candidate = 'webrtc:candidate'
}

export type PredefinedPeerConfig = Without<WebRtcPeerConfiguration, 'onicecandidate'>;

/**
 * Tools for offerer side of WebRTC connection.
 */
export class Offer {
    constructor(private signal: Signal_SessionTo, private onSignal: OnSignal_SessionFrom) {
    }

    /**
     * Creates RTC peer that should create offer.
     *
     * Offer must be created manually via {@see sendOffer} because there are some actions, that must be done before it (creating data channels, for example).
     */
    public createOfferer = (config: PredefinedPeerConfig): WebRtcPeer => {
        const peer = createIceProcessingPeer(config, this.signal, this.onSignal);

        this.onSignal(IceSignals.Answer, ({data}) => {
            log('Processing answer');
            return peer.processAnswer(data, true);
        });

        return peer;
    };

    /**
     * Sends offer to answerer - will be received in {@see Answer.onOffer}.
     */
    public sendOffer = async (offerer: WebRtcPeer): Promise<any> => {
        const sdpOffer = await offerer.generateOffer();
        log('Sending offer');
        return this.signal(IceSignals.Offer, sdpOffer);
    };
}

/**
 * Tools for answerer side of WebRTC connection.
 */
export class Answer {
    constructor(private signal: Signal_Session, private onSignal: OnSignal_SessionFrom) {
    }

    /**
     * Recieves offer from offerer {@see Offer.sendOffer} and sends answer back.
     */
    public onOffer = (config: PredefinedPeerConfig, beforeAnswer: (answerer: WebRtcPeer, from: Connection) => MaybePromiseVoid) => {
        this.onSignal(IceSignals.Offer, async ({data, from}) => {

            const peer = createIceProcessingPeer(config, this.signal(from), this.onSignal);
            await beforeAnswer(peer, from);
            log('Sending answer');
            return this.sendAnswer(peer, data, from);
        });
    };

    private sendAnswer = async (answerer: WebRtcPeer, sdpOffer: string, to: Connection): Promise<any> => {
        const sdpAnswer = await answerer.processOffer(sdpOffer);
        return this.signal(to)(IceSignals.Answer, sdpAnswer);
    };
}

const createIceProcessingPeer = (config: PredefinedPeerConfig, signal: Signal_SessionTo, onSignal: OnSignal_SessionFrom): WebRtcPeer => {
    const onicecandidate = (candidate: RTCIceCandidate) => signal(IceSignals.Candidate, candidate);
    const fullConfig = shallowMerge(config, {onicecandidate});

    const peer = createPeer(fullConfig);
    onSignal(IceSignals.Candidate, ({data}) => {
        log('Candidate received');
        const candidate = new RTCIceCandidate(data);
        return peer.addIceCandidate(candidate);
    });

    return peer;
};

const createPeer = (config: WebRtcPeerConfiguration): WebRtcPeer => {
    const peer = new WebRtcPeer(config);
    window.addEventListener('beforeunload', () => peer.dispose(true));
    log('WebRTC peer created:', peer);
    return peer;
};
