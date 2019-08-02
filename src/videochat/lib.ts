import {DeepReadonly, FailedFetch, getProp, log, setIfValue, successfulFetch, toString} from "shared-ts";
import {clone, hide, play, query, queryAll, show, stop} from "../lib/dom";
import {ParticipantMetadata} from "../lib/tenantApi/shared";
import {SessionParticipant} from "../lib/tenantApi/callSignals";
import {notifyIfPossible} from "../lib/browser";
import {env} from "./env";

const config = {
    amulexApi: {
        client: `${env.hosts.amulex}/client`,
        task: `${env.hosts.amulex}/task/`,
        fetchOptions: (token: string): RequestInit | undefined => ({
            headers: {
                'X-Token': token
            },
            method: 'get',
            mode: 'cors'
        })
    }
};

export type VideochatMetadata = DeepReadonly<{
    name?: string,
    phone?: string,
    token?: string;
    task?: string;
}>;

type Client = DeepReadonly<{
    profile: {
        lastname?: string,
        firstname?: string,
        patronymic?: string
    },
    contacts: {
        phone?: number[]
    },
    cards: [{
        number?: string
    }]
}>;

type Task = DeepReadonly<{
    title: string,
    description: string
}>;

const fetchClient = async (token: string): Promise<Client> => {
    const options = config.amulexApi.fetchOptions(token);
    const response = await successfulFetch(config.amulexApi.client, options);
    return <Client>await response.json();
};

const fetchTask = async (token: string, task: string): Promise<Task> => {
    const options = config.amulexApi.fetchOptions(token);
    const response = await successfulFetch(config.amulexApi.task + task, options);
    return <Task>await response.json();
};

const notifications: { [sessionId: string]: Notification; } = {};
let ringId: number | undefined;

export const showClient = async (participant: SessionParticipant): Promise<void> => {
    const sessionId = participant.session.sessionId;
    const metadata = <VideochatMetadata>participant.participant.custom || {};

    const clientInfo = clone(query('#clientInfoTemplate > *'));
    clientInfo.dataset.sessionId = sessionId;
    query('.name', clientInfo).textContent = metadata.name || 'Имя не известно';
    query('.phone', clientInfo).textContent = metadata.phone || 'не известен';
    query('#roomsInfo').appendChild(clientInfo);

    clearInterval(ringId);
    const audio = <HTMLMediaElement>query('#noteMp3');
    const ring = play(audio);
    await ring(2);
    ringId = setInterval(ring, 10000);
    const onOpen = () => {
        const url = `/room/${sessionId}/${metadata.phone || 0}`;
        window.open(url);
        // @ts-ignore
        ym(52221721, 'reachGoal', 'getCall');
        clearInterval(ringId);
        stop(audio);
        const notification = notifications[sessionId];
        notification && notification.close();
    };

    clientInfo.onclick = onOpen;
    await notifyIfPossible(() => {
        const notification = new Notification('Входящий видеозвонок', {
            body: 'Перейти',
            icon: `${env.hosts.videochat}/images/login-logo.png`
        });
        notification.onclick = onOpen;
        notifications[sessionId] = notification;
    });

    hide(query('#callEmpty'));
};

export const clearClient = (participant: SessionParticipant): void => {
    const sessionId = participant.session.sessionId;

    const clientInfo = document.querySelector(`[data-session-id="${sessionId}"]`);
    if (!clientInfo) {
        return;
    }

    clientInfo.remove();
    clearInterval(ringId);
    const notification = notifications[sessionId];
    notification && notification.close();
    if (!queryAll('[data-session-id]:not([data-session-id=""])').length) {
        show(query('#callEmpty'));
    }
};

export const appendToRoom = async (fullMetadata: ParticipantMetadata): Promise<void> => {
    const metadata = <VideochatMetadata>fullMetadata.custom || {};
    const {name, token, task} = metadata;

    setIfValue(query('.client-name'), 'textContent', name);
    if (!token) {
        return;
    }

    try {
        const client = await fetchClient(token);
        appendHiddenToContactForm('erp-token', token);
        appendClient(client);
        if (task) {
            appendHiddenToContactForm('erp-task', task);
            const taskInfo = await fetchTask(token, task);
            appendTask(taskInfo);
        }
    } catch (error) {
        if (!(error instanceof FailedFetch) || await isAuthorized(error.response)) {
            throw error;
        }

        log(`Unauthorized request to Amulex api, token: ${token}`);
    }
};

const isAuthorized = async (response: Response): Promise<boolean> => {
    const json = await response.clone().json();
    return response.status !== 401 || json.message !== 'Unauthorized';
};

const appendClient = (client: Client, element: HTMLElement = document.documentElement): void => {
    const {profile, contacts} = client;
    setIfValue(<HTMLInputElement>query('#clientbundle_client_firstName', element), 'value', profile.firstname);
    setIfValue(<HTMLInputElement>query('#clientbundle_client_lastName', element), 'value', profile.lastname);
    setIfValue(<HTMLInputElement>query('#clientbundle_client_middleName', element), 'value', profile.patronymic);

    const firstPhone = toString(getProp(contacts.phone, 0));
    setIfValue(<HTMLInputElement>query('#clientbundle_client_phone', element), 'value', firstPhone);

    const cardsContainer = createCardsContainer(client);
    if (cardsContainer) {
        (<HTMLInputElement>query('#clientbundle_client', element)).appendChild(cardsContainer);
    }
};

export const appendHiddenToContactForm = (name: string, value: string) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    query('#contact-form').appendChild(input);
};

const createCardsContainer = (client: Client): HTMLElement | undefined => {
    const cards = client.cards || [];
    if (!cards.length) {
        return undefined;
    }

    const numbers = cards
        .map(card => card.number)
        .join(', ');
    const container = document.createElement('div');
    const label = document.createElement('label');
    label.innerText = `Номера карт: ${numbers}`;
    container.appendChild(label);

    return container;
};

const appendTask = (task: Task, element: HTMLElement = document.documentElement): void => {
    const main = query('#mainBlockContent', element);
    const header = query('h4', main);

    const container = document.createElement('div');
    const label = document.createElement('label');
    label.innerText = `Обращение: ${task.title} / ${task.description}`;
    container.appendChild(label);
    main.insertBefore(container, header.nextSibling);
};
