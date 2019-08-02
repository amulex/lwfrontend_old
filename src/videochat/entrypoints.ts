import {
    createConsultantSignals,
    defaultInit,
    Media,
    MetadataOptions,
    ParticipantMetadata,
    ParticipantType,
    Stream
} from "../lib/tenantApi/shared";
import {appendHiddenToContactForm, appendToRoom, clearClient, showClient} from "./lib";
import {hide, query, queryAll, show} from "../lib/dom";
import {PlayerAction} from "../lib/tenantApi/view/buttons/player";
import {Connection, Publisher, StreamManager, VideoElementEvent} from "openvidu-browser";
import {env} from "../env";
import {config} from "../config";
import {createAuthFetch, Credentials, fetchProfile} from "../lib/backend";
import {assert, combineProcedures, toBool, toString} from "shared-ts";

export const index = async (credentials: Credentials) => {
    config.init(env);
    const fetch = await createAuthFetch(credentials);
    const profile = await fetchProfile(fetch);
    const signals = await createConsultantSignals(profile, fetch);
    await signals.onCall(showClient);
    await signals.onLeft(clearClient);
    return signals.onFirstMaxParticipants(clearClient);
};

export const room = async (credentials: Credentials, sessionId: string) => {
    let recordEnabled: boolean | undefined;

    const metadata = {
        handle: combineProcedures((metadata: ParticipantMetadata, connection: Connection) => {
            appendHiddenToContactForm('client-connection-id', connection.connectionId);
            const record = metadata.system.profile.settings.init.record;
            recordEnabled = toBool(record);
        }, appendToRoom)
    };
    const elements = {
        streamsTargets: {
            publisher: 'videoContainer',
            subscriber: 'videoContainer'
        },
        handleTargets: {
            created: (event: VideoElementEvent) => {
                if (event.target instanceof Publisher) {
                    event.element.classList.add(...'call-panel__video-local col s2 m2 l2'.split(' '));
                }
            }
        },
        buttons: [{
            elements: () => queryAll('#toggleVideo'),
            streams: [Stream.Publisher],
            media: [Media.Video],
            action: PlayerAction.Toggle
        }, {
            elements: () => queryAll('#toggleAudio'),
            streams: [Stream.Publisher],
            media: [Media.Audio],
            action: PlayerAction.Toggle
        }]
    };

    appendHiddenToContactForm('session-id', sessionId);
    const consultant = await defaultInit(ParticipantType.Consultant, credentials, elements, env, metadata);
    const session = await consultant.answer(sessionId);
    const leaveButton = query('#leave');
    const onLeave = () => {
        assert(recordEnabled !== undefined);
        appendHiddenToContactForm('video-recorded', toString(recordEnabled!));
        consultant.leave();
    };

    consultant.onParticipantLeft(ParticipantType.Client, onLeave);
    leaveButton.onclick = onLeave;
};

export const client = async (credentials: Credentials, metadata: MetadataOptions = {}) => {
    const elements = {
        streamsTargets: {
            publisher: query('#publisher-container'),
            subscriber: query('#subscriber-container')
        },
        handleTargets: {
            created: (event: VideoElementEvent) => hide(query('video[poster]', (<StreamManager>event.target).targetElement)),
            destroyed: (event: VideoElementEvent) => show(query('video[poster]', (<StreamManager>event.target).targetElement)),
        },
        buttons: [{
            elements: () => queryAll('#toggle-local-audio'),
            streams: [Stream.Publisher],
            media: [Media.Audio],
            action: PlayerAction.Toggle
        }, {
            elements: () => queryAll('#toggle-remote-audio'),
            streams: [Stream.Subscriber],
            media: [Media.Audio],
            action: PlayerAction.Toggle
        }]
    };
    const client = await defaultInit(ParticipantType.Client, credentials, elements, env, metadata);
    const button = <HTMLButtonElement>query('#video-call');
    button.disabled = false;
    button.onclick = async () => {
        button.disabled = true;
        hide(query('#btn-container'));
        show(query('#widget-container'));

        const session = await client.call();
        const toInitState = () => {
            button.disabled = false;
            show(query('#btn-container'));
            hide(query('#widget-container'));
            client.leave();
        };

        query('#leave-call').onclick = toInitState;
        client.onParticipantLeft(ParticipantType.Consultant, toInitState);
    };
};
