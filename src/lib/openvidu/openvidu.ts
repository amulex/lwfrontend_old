import {
    Connection, OpenVidu, OpenViduError, Publisher, PublisherProperties, Session,
    VideoElementEvent
} from "openvidu-browser";
import {ConnectOptions, Fetch, log, MaybePromiseVoid, noop, FetchHelper} from "@devlegal/shared-ts";
import {config} from "../../config";
import {logConnectionFactory} from "../backend";

export type HandleSession = (session: Session) => MaybePromiseVoid;
export type HandleVideoElementEvent = (event: VideoElementEvent) => MaybePromiseVoid;

/**
 * @link https://openvidu.io/api/openvidu-browser/classes/openvidu.html#initpublisher
 * @link https://openvidu.io/api/openvidu-browser/classes/session.html#subscribe
 * See targetElement argument description.
 */
export type OpenViduTargetElement = string | HTMLElement;

/**
 * Type for {@see Connection.connectionId}
 */
export type ConnectionId = string;

/**
 * type for {@see Session.sessionId}
 */
export type SessionId = string;

/**
 * @param beforeConnect Some actions must be done after OpenVidu.initSession and before Session.connect - event listening, for example
 */
export type ConnectFactory<R> = (beforeConnect?: HandleSession) => R;
/**
 * Performs whole session connection.
 *
 * Uses both OpenVidu REST/Node/Java client on middleware and session initiation/connection/auto-disconnection on client.
 */
export type ConnectSessionFactory = ConnectFactory<ConnectSession>;

/**
 * @return new Session instance; use Session.openvidu instead of global instance for more then one sessions
 * @throws FailedFetch 403 If max partcipants reached
 */
export type ConnectSession = (options: ConnectOptions) => Promise<Session>;

export type PublishersConnectSessionFactory = ConnectFactory<PublishersConnectSession>;
/**
 * throws and return: same as {@see ConnectSession}
 * @throws OVPublisherError
 */
export type PublishersConnectSession = (options: ConnectOptions, publisherProperties?: PublisherProperties) => Promise<Publisher>;

/**
 * If OpenVidu.initPublisherAsync produced error {@see OpenViduErrorName}.
 */
export type OVPublisherError = OpenViduError;

/**
 * Global instance of OpenVidu class.
 *
 * Must be used for non-instance specific methods only (enableProdMode, getDevices etc. instead of initSession, initPublisher etc.).
 * For instance specific methods use new OpenVidu instance per session.
 */
export const openviduGlobal = new OpenVidu();

/**
 * Creates ConnectSessionFactory function with given fetch.
 *
 * Fetch used for access to middleware, hence it should have proper authentication headers/other stuff.
 */
export const connectToSessionFactory = (fetch: Fetch): ConnectSessionFactory => {
    const logConnection = logConnectionFactory(fetch);

    return (beforeConnect = noop) => async (options) => {
        const response = await FetchHelper.postJson(config.get().paths.middleware.createToken, options, fetch);
        const {token} = await response.json();

        const openVidu = new OpenVidu();
        const session = openVidu.initSession();
        await beforeConnect(session);
        await session.connect(token);

        logConnection(session);
        log('Session connected', session, 'with token', token, 'connection id', session.connection.connectionId);
        return session;
    };
};

export const getAllConnections = (session: Session): Connection[] =>
    Object.values(session.remoteConnections).concat(session.connection);
