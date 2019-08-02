import underscore from "underscore";
import {assert, lazy} from "@devlegal/shared-ts";

export type Env = {
    host: {
        backend: string,
        middleware: string
    }
};

class Config {
    private env: Env | undefined;

    public get = lazy(() => {
        assert(this.env, 'Config environment is not initialized');
        const env = this.env!;

        return {
            paths: {
                backend: underscore.mapObject(
                    {
                        login: '/login',
                        loginRefresh: '/login/refresh',
                        profile: '/users/current/profile',
                        userInfo: '/users/info',
                        tenant: '/users/current/tenant',
                        sessions: '/sessions',
                        connections: '/connections',
                        participantRoles: '/connections/roles',
                        messages: '/messages',
                    },
                    (val: any, key: any) => `${env.host.backend}/api${val}`),
                middleware: underscore.mapObject(
                    {
                        createToken: '/createToken',
                    },
                    (val: any, key: any) => env.host.middleware + val),
            }
        };
    });

    public init = (env: Env) => {
        assert(!this.env, 'Config environment must be initialized only once');
        this.env = env;
    };
}

export const config = new Config();
