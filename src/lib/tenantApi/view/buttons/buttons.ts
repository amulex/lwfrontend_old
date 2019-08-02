import {Publisher, StreamManager, Subscriber, VideoElementEvent} from "openvidu-browser";
import {Media, Stream} from "../../shared";
import {DeepReadonly} from "@devlegal/shared-ts";
import {HandleVideoElementEvent} from "../../../openvidu/openvidu";
import {CompositePlayer, PlayerAction, SimplePlayer} from "./player";

export type ButtonsPermissions = DeepReadonly<{
    custom: {
        [K in Stream]: {
            [T in Media]?: boolean;
        }
    },
    native: {
        [K in Stream]?: boolean
    }
}>;

export type ButtonConfig = DeepReadonly<{
    /**
     * Here element can be cloned and appended to container.
     * Elements will not be removed on participant leaving, this is should be done manually because of cloning logic taken out of bounds of library.
     * There can be several elements for same purpose (for example, widget have separate buttons for toggling mic(sound) in audio-call and video-call blocks)
     */
    elements: (e: VideoElementEvent) => HTMLElement[],
    streams: Stream[],
    media: Media[],
    action: PlayerAction
}>;

type PlayerActions = DeepReadonly<{
    [K in Stream]: {
        [T in Media]: {
            [P in 'play' | 'pause']: (sm: StreamManager) => void;
        }
    }
}>;

const playerActions: PlayerActions = {
    publisher: {
        video: {
            play: (publisher) => (publisher as Publisher).publishVideo(true),
            pause: (publisher) => (publisher as Publisher).publishVideo(false),
        },
        audio: {
            play: (publisher) => (publisher as Publisher).publishAudio(true),
            pause: (publisher) => { console.log("UNPUBLISH PUB AUDIO", publisher); (publisher as Publisher).publishAudio(false); },
        }
    },
    subscriber: {
        video: {
            play: (subscriber) => (subscriber as Subscriber).subscribeToVideo(true),
            pause: (subscriber) => (subscriber as Subscriber).subscribeToVideo(false),
        },
        audio: {
            play: (subscriber) => (subscriber as Subscriber).subscribeToAudio(true),
            pause: (subscriber) => { console.log("UNPUBLISH SUB AUDIO", subscriber); (subscriber as Subscriber).subscribeToAudio(false); },
        }
    }
};

/**
 * Creates a function that add buttons to newly created stream (publisher's or subscriber's).
 */
export const addButtonsFactory = (permissions: ButtonsPermissions, srcButtons: ButtonConfig[]): HandleVideoElementEvent => {
    const buttons = excludeDenied(srcButtons, permissions);

    return (event) => {
        const streamManager = event.target as StreamManager;
        const stream = getStream(streamManager);

        showNativeControls(event.element, permissions, stream);

        const streamButtons = buttons.filter(button => button.streams.includes(stream));
        for (const button of streamButtons) {
            const players = button.media.map(media => {
                const actions = playerActions[stream][media];
                return new SimplePlayer(
                    () => actions.play(streamManager),
                    () => actions.pause(streamManager)
                );
            });
            const player = new CompositePlayer(players);
            button.elements(event).forEach(el => el.addEventListener('click', player[button.action]));
        }
    };
};

const showNativeControls = (element: HTMLVideoElement, permissions: ButtonsPermissions, stream: Stream): void => {
    if (permissions.native[stream]) {
        element.controls = true;
    }
};

/**
 * Example: if button controls audio and video streams for publisher, but only audio allowed, button will be completly excluded anyway.
 */
const excludeDenied = (buttons: ButtonConfig[], permissions: ButtonsPermissions): ButtonConfig[] =>
    buttons.filter(button => {
        for (const stream of button.streams) {
            for (const media of button.media) {
                if (!permissions.custom[stream][media]) {
                    return false;
                }
            }
        }

        return true;
    });

export const getStream = (manager: StreamManager): Stream => {
    if (manager instanceof Publisher) {
        return Stream.Publisher;
    }
    if (manager instanceof Subscriber) {
        return Stream.Subscriber;
    }
    throw new Error('Invalid stream type');
};
