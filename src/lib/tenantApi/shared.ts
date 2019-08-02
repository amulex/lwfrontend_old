import {
    assert,
    combineProcedures,
    ConnectOptions,
    CustomizableSessionOpts,
    DeepReadonly,
    Fetch,
    getProp,
    jsonParseDefault,
    log,
    MaybePromiseVoid,
    noop,
    shallowMerge,
    size
} from "@devlegal/shared-ts";
import {config, Env} from "../../config";
import {ClientApi} from "./api/ClientApi";
import {ConsultantApi} from "./api/ConsultantApi";
import {
    ConnectSessionFactory,
    connectToSessionFactory,
    HandleSession,
    HandleVideoElementEvent,
    openviduGlobal,
    OpenViduTargetElement,
    PublishersConnectSessionFactory
} from "../openvidu/openvidu";
import {bindTransportAgentsFactory, FileTransportAgent, TextTransportAgent} from "./transports/transports";
import {
    Connection, Publisher, Session, StreamEvent, StreamManager, Subscriber,
    VideoElementEvent
} from "openvidu-browser";
import {addButtonsFactory, ButtonConfig, ButtonsPermissions} from "./view/buttons/buttons";
import {ChatElements, FileElements, initFileChatFactory, initTextChatFactory} from "./view/chat";
import {CallSignals, ClientSignals, ConsultantSignals} from "./callSignals";
import {
    createAuthFetch, Credentials, fetchProfile, fetchTenant, fetchUserInfo, ParticipantInfo, Profile, Tenant,
    UserInfo
} from "../backend";

export type Settings = DeepReadonly<{
    streams: StreamsProperties,
    buttons: ButtonsPermissions,
    chat: {
        text?: boolean,
        file?: boolean,
    },
    init: {
        session: CustomizableSessionOpts,
        record?: boolean,
        maxParticipants: number
    }
}>;

type StreamsProperties = DeepReadonly<{
    publisher: Partial<{
        frameRate: number;
        mirror: boolean;
        audioSource: false;
        videoSource: false,
        publishAudio: boolean;
        publishVideo: boolean;
        resolution: string;
    }>,
    subscriber: Partial<{
        subscribeToAudio: boolean;
        subscribeToVideo: boolean;
    }>
}>;

export enum Stream {Publisher = 'publisher', Subscriber = 'subscriber'}

export enum Media {Video = 'video', Audio = 'audio'}

type ChatView = ChatElements | TextTransportAgent;
type FileView = FileElements | FileTransportAgent;
export type ViewSettings = {
    streamsTargets: StreamsTargets,
    handleTargets?: {
        created?: HandleVideoElementEvent,
        destroyed?: HandleVideoElementEvent
    },
    buttons?: ButtonConfig[];
    chat?: {
        text?: ChatView,
        file?: FileView
    }
};

type StreamsTargets = {
    [K in Stream]: OpenViduTargetElement
    };

export enum ParticipantType {Client = 'client', Consultant = 'consultant'}

export type MetadataOptions = DeepReadonly<{
    data?: CustomMetadata;
    /**
     * Handler for other participants' metadata, will be called on streamCreated event.
     */
    handle?: HandleMetadata
}>;
/**
 * Custom data that will be shown to other participants.
 */
type CustomMetadata = any;

export type ParticipantMetadata = {
    custom: CustomMetadata,
    system: {
        type: ParticipantType
        profile: ParticipantInfo
    }
};

export type HandleMetadata = (md: ParticipantMetadata, c: Connection) => MaybePromiseVoid;

type ParticipantMap = {
    client: ClientApi,
    consultant: ConsultantApi
};

/**
 * Default entry point function, for advanced cases use combination of API functions/classes.
 */
export const defaultInit = async <K extends ParticipantType>(type: K, credentials: Credentials, elements: ViewSettings, env: Env, options: MetadataOptions = {}): Promise<ParticipantMap[K]> => {
    config.init(env);
    const fetch = await createAuthFetch(credentials);
    const profile = await fetchProfile(fetch);
    return createParticipant(type, profile, elements, fetch, options);
};

export const createParticipant = async <K extends ParticipantType>(type: K, profile: Profile, elements: ViewSettings, fetch: Fetch, options: MetadataOptions = {}): Promise<ParticipantMap[K]> => {
    assert(openviduGlobal.checkSystemRequirements() === 1, 'OpenVidu isn\'t supported');
    assert(type !== ParticipantType.Consultant || isConsultantRole(profile.role.role), `Consultant must have role ROLE_CONSULTANT, but ${profile.role.role} given`);

    const tenant: Tenant = await fetchTenant(fetch);
    const agents = createTransportAgents(profile.settings.chat, elements.chat);
    const bindTransportAgents = bindTransportAgentsFactory(fetch, ...agents);

    const metadata = createMetadata(options, type, profile);
    const connectOptions: ConnectOptions = shallowMerge(profile.settings.init, {
        token: {
            data: JSON.stringify(metadata)
        },
    });
    const handleMetadata = handleMetadataFactory(options, fetch);
    const addButtons = addButtonsFactory(profile.settings.buttons, elements.buttons || []);
    const handleVideoCreated = combineProcedures(handleMetadata, addButtons, getProp(elements.handleTargets, 'created') || noop);
    const handleVideoDestroyed = getProp(elements.handleTargets, 'destroyed');

    const signalsCtor = type === ParticipantType.Consultant ? ConsultantSignals : ClientSignals;
    const participantCtor = type === ParticipantType.Consultant ? ConsultantApi : ClientApi;

    const connectToSession = connectToSessionFactory(fetch);
    const signals = new signalsCtor(connectToSession(), profile, tenant, metadata, fetch);
    const allToAllConnect = allToAllConnectSessionMetafactory(connectToSession, profile.settings, elements.streamsTargets, signals, handleVideoCreated, handleVideoDestroyed)(bindTransportAgents);
    return new participantCtor(profile, allToAllConnect, connectOptions, signals as ConsultantSignals & ClientSignals);
};

export const createConsultantSignals = async (profile: Profile, fetch: Fetch, options: MetadataOptions = {}): Promise<ConsultantSignals> => {
    const connectToSession = connectToSessionFactory(fetch);
    const tenant: Tenant = await fetchTenant(fetch);
    const metadata = createMetadata(options, ParticipantType.Consultant, profile);
    return new ConsultantSignals(connectToSession(), profile, tenant, metadata, fetch);
};

/**
 * Creates a function that connects to the session as a publisher and connects all created in the session streams as subscribers, all according with given stream settings.
 */
const allToAllConnectSessionMetafactory = (decorated: ConnectSessionFactory, settings: Settings, targets: StreamsTargets, signals: CallSignals, videoCreated: HandleVideoElementEvent = noop, videoDestroyed: HandleVideoElementEvent = noop): PublishersConnectSessionFactory => {
    const handleVideoCreating = (streamManager: StreamManager): void => {
        streamManager.on('videoElementCreated', async (event) => {
            // For some reason exceptions will be absorbed here
            try {
                await videoCreated(event as VideoElementEvent);
            } catch (error) {
                log('Error in videoCreated:', error);
            }
        });
        streamManager.on('videoElementDestroyed', async (event) => {
            // For some reason exceptions will be absorbed here
            try {
                await videoDestroyed(event as VideoElementEvent);
            } catch (error) {
                log('Error in videoDestroyed:', error);
            }
        });
    };
    const onStreamCreated = (session: Session): void => {
        session.on('streamCreated', async (event) => {
            if (size(session.remoteConnections) + 1 >= settings.init.maxParticipants) {
                // Session has not .connection.stream yet, but it is necessary for signalParticipant
                session.connection.stream = (event as StreamEvent).stream;
                await signals.maxParticipants(session);
            }

            const subscriber = session.subscribe((event as StreamEvent).stream, targets.subscriber, settings.streams.subscriber);
            handleVideoCreating(subscriber);
        });
    };

    return (beforeConn: HandleSession = noop) => async (options, customProperties = {}) => {
        const beforeConnect = combineProcedures(beforeConn, onStreamCreated);
        const session = await decorated(beforeConnect)(options);
        const properties = shallowMerge(settings.streams.publisher, customProperties);

        const publisher = await session.openvidu.initPublisherAsync(targets.publisher, properties);
        handleVideoCreating(publisher);
        await session.publish(publisher);
        log('Published media', properties, publisher);

        return publisher;
    };
};



const createTransportAgents = (settings: Settings['chat'], elements: ViewSettings['chat']): [TextTransportAgent, FileTransportAgent] => {
    const textView = getProp(elements, 'text');
    const fileView = getProp(elements, 'file');

    const textAgent = textView && settings.text
        ? isTextElements(textView) ? initTextChatFactory(textView) : textView
        : noop;
    const fileAgent = fileView && settings.file
        ? isFileElements(fileView) ? initFileChatFactory(fileView) : fileView
        : noop;

    return [textAgent, fileAgent];
};

const isTextElements = (elements: ChatView): elements is ChatElements =>
    (elements as ChatElements).input !== undefined;

const isFileElements = (elements: FileView): elements is FileElements =>
    (elements as FileElements).input !== undefined;

const handleMetadataFactory = (options: MetadataOptions, fetch: Fetch): HandleVideoElementEvent =>
    async (event) => {
        const streamManager = event.target;
        if (streamManager instanceof Subscriber) {
            const handle = options.handle || noop;
            const data = getMetadata(streamManager.stream.connection);
            const userInfo = await fetchUserInfo(fetch, data.system.profile.email);
            data.system.profile.avatar = userInfo.avatar;
            return handle(data, streamManager.stream.connection);
        }
    };

export const getMetadata = (connection: Connection): ParticipantMetadata =>
    jsonParseDefault(connection.data) as ParticipantMetadata;

const createMetadata = (options: MetadataOptions, type: ParticipantType, profile: Profile): ParticipantMetadata => ({
    custom: options.data,
    system: {type, profile}
});

export const isConsultantRole = (role?: string): boolean => role === 'ROLE_CONSULTANT';
