import {dateReviver, Jsonable, JsonParseReviver, log} from "@devlegal/shared-ts";
import {Connection, Session, SignalEvent} from "openvidu-browser";


export type Signal_Session = (...to: Connection[]) => Signal_SessionTo;
export type Signal_SessionTo = (type?: string, data?: Jsonable) => Promise<any>;

/**
 * Calls Session.signal with JSON-encoded data and supporting currying.
 */
export const signal = (session: Session) => (...to: Connection[]) => (type?: string, data?: Jsonable) => {
    const options = {data: JSON.stringify(data), type, to};
    log(`Sending signal ${options.type}`, options, to);
    return session.signal(options);
};

export type OnSignal_Session = (onlyFrom?: Connection | 'notOwn') => OnSignal_SessionFrom;
export type OnSignal_SessionFrom = (type: string | undefined, handle: HandleSignalJsonEvent, reviver?: JsonParseReviver) => void;

type SignalJsonEvent = {
    type: string;
    data: Jsonable;
    from: Connection;
};
type HandleSignalJsonEvent = (event: SignalJsonEvent) => void;

/**
 * Calls Session.on('signal:...) with JSON-decoded data and supporting currying.
 */
export const onSignal = (session: Session) => (onlyFrom?: Connection | 'notOwn') =>
    (signalType: string | undefined, handle: HandleSignalJsonEvent, reviver: JsonParseReviver = dateReviver) => {

        const fullType = signalType ? `signal:${signalType}` : 'signal';
        log(`Start listening signal ${fullType}`);

        session.on(fullType, (event) => {

            const {type, data, from} = event as SignalEvent;
            if (onlyFrom === 'notOwn' && session.connection.connectionId === from.connectionId
                || onlyFrom instanceof Connection && onlyFrom.connectionId !== from.connectionId) {
                return;
            }
            handle({type, data: JSON.parse(data, reviver), from});
        });
    };
