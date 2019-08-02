import {assert, DeepReadonly, setIfObject, DomHelper} from "@devlegal/shared-ts";
import {FileTransportAgent, TextTransportAgent} from "../transports/transports";
import {HandleText} from "../transports/text";
import {HandleFile} from "../transports/file";

type HandleMessage = TemplateElements | HandleText;
export type ChatElements = DeepReadonly<{
    input: HTMLInputElement | HTMLTextAreaElement,
    button?: HTMLElement
    messages: HandleMessage
}>;

type HandleFileElements = FileTemplateElements | HandleFile;
export type FileElements = DeepReadonly<{
    input: HTMLInputElement,
    messages: HandleFileElements
}>;

type TemplateElements = DeepReadonly<{
    container: HTMLElement,
    messageTemplate: HTMLElement
    formatTime: (time: Date) => string;
}>;

type FileTemplateElements = TemplateElements & { formatText: (f: File) => string };

const enterKeyCode = 13;

export const initTextChatFactory = ({input, button, messages}: ChatElements): TextTransportAgent =>
    (transport) => {
        const send = () => {
            const text = input.value.trim();
            input.value = '';
            if (text) {
                return transport.send({text, time: new Date()});
            }
        };

        input.onkeypress = async (event) => {
            if (event.keyCode === enterKeyCode && !(event.shiftKey || event.altKey)) {
                event.preventDefault();
                return send();
            }
        };

        if (button) {
            button.addEventListener('click', send);
        }

        const handle = isMessagesElements(messages) ? defaultTextHandlerFactory(messages) : messages;
        transport.onReceived(handle);
    };

const defaultTextHandlerFactory = (messages: TemplateElements): HandleText => ({custom, system}) => {
    const {text, time} = custom;
    const {messageTemplate, formatTime, container} = messages;
    const newMessage = DomHelper.clone(messageTemplate);

    newMessage.classList.add(system.stream);
    setIfObject(DomHelper.queryMaybe('.time', newMessage), 'textContent',  formatTime(time));
    setIfObject(DomHelper.queryMaybe('.message', newMessage), 'textContent', text);

    container.appendChild(newMessage);
};

/**
 * Adds to chat support of sending/receiving files.
 */
export const initFileChatFactory = ({input, messages}: FileElements): FileTransportAgent => {
    const type = input.type;
    assert(type === 'file', `Type of input must be "file", ${type} given`);

    return (transport) => {
        input.onchange = async () => {
            const files = input.files!;
            for (const file of files) {
                await transport.send({file, time: new Date()});
            }
            input.value = '';
        };

        const handle = isFileMessagesElements(messages) ? defaultFileHandlerFactory(messages) : messages;
        transport.onReceived(handle);
    };
};

const defaultFileHandlerFactory = (messages: FileTemplateElements): HandleFile => ({custom, system}) => {
    const {file, time} = custom;
    const {messageTemplate, formatTime, formatText, container} = messages;
    const newMessage = DomHelper.clone(messageTemplate);

    newMessage.classList.add(system.stream);
    setIfObject(DomHelper.queryMaybe('.time', newMessage), 'textContent', formatTime(time));

    const anchor = DomHelper.queryMaybe('a[download]', newMessage);
    if (anchor instanceof HTMLAnchorElement) {
        anchor.href = URL.createObjectURL(file);
        anchor.download = file.name;
        anchor.textContent = formatText(file);
    }

    container.appendChild(newMessage);
};

const isMessagesElements = <M>(messages: HandleMessage): messages is TemplateElements =>
    (messages as TemplateElements).messageTemplate !== undefined;

const isFileMessagesElements = <M>(messages: HandleFileElements): messages is FileTemplateElements =>
    (messages as FileTemplateElements).formatText !== undefined;
