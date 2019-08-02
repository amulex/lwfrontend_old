export enum PlayerAction {Play = 'play', Pause = 'pause', Toggle = 'toggle'}

/**
 * Encapsulates "paused" state in buttons.
 */
type Player = {
    readonly paused: boolean;
    play(): void;
    pause(): void;
    toggle(): void;
};

export class SimplePlayer implements Player {
    constructor(private playCb: () => void, private pauseCb: () => void, private _paused: boolean = false) {
    }

    public get paused() {
        return this._paused;
    }

    public play = () => {
        if (this.paused) {
            this.playCb();
            this._paused = false;
        }
    };

    public pause = () => {
        if (!this.paused) {
            this.pauseCb();
            this._paused = true;
        }
    };

    public toggle = () => {
        this._paused ? this.play() : this.pause();
    };
}

/**
 * Combines several players that behaves as the only.
 */
export class CompositePlayer implements Player {
    constructor(private players: Player[]) {
    }

    public get paused() {
        return this.players.length ? this.players[0].paused : false;
    }

    public play = () => {
        for (const player of this.players) {
            player.play();
        }
    };

    public pause = () => {
        for (const player of this.players) {
            player.pause();
        }
    };

    /**
     * When toggles, orients to the first player "paused" state and plays or pauses all players uniformly.
     */
    public toggle = () => {
        const toggleMethod = this.paused ? 'play' : 'pause';

        for (const player of this.players) {
            player[toggleMethod]();
        }
    };
}
