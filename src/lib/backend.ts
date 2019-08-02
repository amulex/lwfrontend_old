import {ConnectionId} from "./openvidu/openvidu";
import {
    Base64,
    clone,
    FetchHelper,
    DeepReadonly,
    Email,
    Fetch,
    filterDictionary,
    log,
    MimeType,
} from "@devlegal/shared-ts";
import {config} from "../config";
import {Connection, Session} from "openvidu-browser";
import {Settings} from "./tenantApi/shared";

export type Login = Readonly<{
    email: Email,
    password: string
}>;

export type JwtToken = Readonly<{
    token: string;
    refresh_token: string;
}>;

export type Credentials = Login | JwtToken;
/**
 * Role string with "ROLE_" prefix.
 */
type RoleString = string;

type BaseProfile = {
    email: Email,
    name?: string,
    surname?: string,
    patronymic?: string,
    role: {
        role: RoleString
    }
};

export type Profile = BaseProfile & {
    settings: Settings
};

export type UserInfo = BaseProfile & {
    avatar?: Base64
};

export type ParticipantInfo = Profile & UserInfo;

export type Tenant = DeepReadonly< {
    key: string,
    name: string,
    logo?: Base64,
    greeting?: string
}>;

export type Message = {
    type: MessageType,
    typeRelated: TextData | FileData,
    time: Date,
    connection: ConnectionId
};

type TextData = {
    text: string;
}
type FileData = {
    name: string,
    type: MimeType,
    size: number
};

export enum MessageType {Text = 'text', File = 'file'}

const successfulFetchExcept401 = FetchHelper.createSuccessfulFetch(async response => response.ok || await isExpired(response), fetch);

/**
 * Returns a fetch function that will add headers for proper authorization on every request.
 *
 * Because middleware proxies authorization to backend, both middleware and backend need same authorization, hence same authorized fetch.
 *
 * @param decorated Must return response with 401 status as usual, without throwing exception, because it is used for token refreshing
 */
const createAuthFetchFromToken = (token: JwtToken, decorated: Fetch = successfulFetchExcept401): Fetch => {
    const createAuthHeaders = (jwtToken: JwtToken): Headers => {
        const headers = new Headers();
        headers.set('authorization', `Bearer ${jwtToken.token}`);
        return headers;
    };
    const refreshHeaders = async (jwtToken: JwtToken): Promise<Headers> => {
        const response = await FetchHelper.postJson(config.get().paths.backend.loginRefresh, jwtToken, decorated);
        const refreshedToken = await response.json();
        return createAuthHeaders(refreshedToken);
    };
    let authHeaders = createAuthHeaders(token);

    return async (url, passedInit?) => {
        const init = passedInit ? clone(passedInit) : {};
        init.headers = FetchHelper.mergeHeaders(init.headers, authHeaders);

        const response = await decorated(url, init);
        if (response.ok) {
            return response;
        }

        authHeaders = await refreshHeaders(token);
        return fetch(url, init);
    };
};

const isExpired = async (response: Response): Promise<boolean> => {
    const {detail = ''} = await response.json();
    return response.status === 401 && detail.toLowerCase().includes('expire');
};

export const createAuthFetch = async (credentials: Credentials): Promise<Fetch> =>
    createAuthFetchFromToken(await getToken(credentials));

const getToken = async (credentials: Credentials): Promise<JwtToken> => {
    if (isToken(credentials)) {
        return credentials;
    }

    const token = await login(credentials);
    log('Given token:', token, 'for credentials:', credentials);
    return token;
};

const isToken = (credentials: Credentials): credentials is JwtToken => {
    const maybeToken = credentials as JwtToken;
    return maybeToken.token !== undefined && maybeToken.refresh_token !== undefined;
};

export const fetchProfile = async (fetch: Fetch): Promise<Profile> => {
    const response = await fetch(config.get().paths.backend.profile);
    return response.json();
};

export const fetchTenant = async (fetch: Fetch): Promise<Tenant> => {
    const response = await fetch(config.get().paths.backend.tenant);
    return response.json();
};

export const fetchUserInfo = async (fetch: Fetch, email: string): Promise<UserInfo> => {
    const response = await fetch(`${config.get().paths.backend.userInfo}?email=${email}`);
    return response.json();
};

const login = async (credentials: Login): Promise<JwtToken> => {
    const response = await FetchHelper.postJson(config.get().paths.backend.login, credentials);
    return response.json();
};

export const logMessage = (message: Message, fetch: Fetch): Promise<Response> =>
    FetchHelper.postJson(config.get().paths.backend.messages, message, fetch);

/**
 * See ImportCdr description on backend for details.
 */
export const logConnectionFactory = (fetch: Fetch) => async (session: Session): Promise<Response> => {
    await FetchHelper.postJson(config.get().paths.backend.sessions, {id: session.sessionId}, fetch);
    return FetchHelper.postJson(config.get().paths.backend.connections, {
        id: session.connection.connectionId,
        session: session.sessionId
    }, fetch);
};

type ParticipantRoles = { [connectionId: string]: RoleString };
type FetchParticipantRoles = (connectionIds: ConnectionId[], fetch: Fetch) => Promise<ParticipantRoles>;

const fetchParticipantRoles: FetchParticipantRoles = async (connectionIds, fetch) => {
    const url = new URL(config.get().paths.backend.participantRoles);
    FetchHelper.searchParamsAddArray('id[]', connectionIds, url.searchParams);
    const response = await fetch(url.toString());
    return response.json();
};

const fetchParticipantRolesCached = ((): FetchParticipantRoles => {
    const cache: ParticipantRoles = {};
    return async (connectionIds, fetch) => {
        const notCachedIds = connectionIds.filter(connectionId => !cache[connectionId]);

        if (notCachedIds.length) {
            const newRoles = await fetchParticipantRoles(notCachedIds, fetch);
            Object.assign(cache, newRoles);
        }

        return filterDictionary(cache, (role, id) => connectionIds.includes(id));
    };
})();

/**
 * @param predicate role is undefined if connection wasn't found on backend
 */
export const filterParticipantsByRole = async (connections: Connection[], predicate: (role?: RoleString) => boolean, fetch: Fetch): Promise<Connection[]> => {
    const ids = connections.map(c => c.connectionId);
    const roles = await fetchParticipantRolesCached(ids, fetch);
    return connections.filter(connection => predicate(roles[connection.connectionId]));
};
