import _ from "lodash";
import { getLogger } from "./logger";
import * as ee2 from "eventemitter2";

type VueComponent = { $once: Function };

/**
 * Register all the listeners to be destroyed when the given vue component is destroyed
 * @param emmitter
 * @param vue
 */
export const disposeOnVueDestroy = function (emmitter: ee2.EventEmitter2, vue: VueComponent): ee2.EventEmitter2 {
    vue.$once("hook:beforeDestroy", () => {
        emmitter.removeAllListeners();
    });
    return emmitter;
};

export class Event<TArgs extends {}> {
    constructor(readonly NAME: string, readonly args: TArgs) {}
}

export interface EventListener<Targs extends {}> {
    (event: Event<Targs>): void;
}

export const $defaultEmmitter = new ee2.EventEmitter2({});

export class EventDefaults {
    static readonly DEFAULT = new EventDefaults($defaultEmmitter, {});

    readonly emmitter: ee2.EventEmitter2;
    private readonly _options: ee2.OnOptions;

    constructor(emmitter?: ee2.EventEmitter2, options?: ee2.OnOptions) {
        this.emmitter = emmitter || EventDefaults.DEFAULT.emmitter;
        this._options = options || EventDefaults.DEFAULT._options;
    }

    get onOptions(): ee2.OnOptions {
        return { ...this._options } as const;
    }

    withEmmitter(emmitter: ee2.EventEmitter2) {
        return new EventDefaults(emmitter, this._options);
    }

    withOptions(options: ee2.OnOptions) {
        return new EventDefaults(this.emmitter, options);
    }

    /**
     * Create an event emitter using the options and emiiter of this defaults
     */
    defineEvent<TEventArgs extends {} = {}>(name: string): EventDef<TEventArgs> {
        return new EventDef(name, this._options, this.emmitter);
    }
}

const eventSubscriptionLog = getLogger("events.EventSubscription");
export class EventSubscription {
    private static _idCount = 0;

    private _registeredWithVue = false;
    private _cancelled = false;
    private readonly _id: string;

    constructor(private readonly eventDef: EventDef<any>, private readonly listener: EventListener<any>) {
        this._id = `${++EventSubscription._idCount}.${eventDef.NAME}`;
    }

    /**
     * If the event listener is cancelled
     */
    get cancelled() {
        return this._cancelled;
    }

    /**
     * The unique id of this subscription. Useful for debugging purposes
     */
    get id() {
        return this._id;
    }

    /**
     * Remove the event listener bound to this subscription
     */
    cancel() {
        if (this._cancelled) {
            return;
        }
        this._cancelled = true;
        if (eventSubscriptionLog.isTraceEnabled()) {
            eventSubscriptionLog.trace(`cancel subscription '${this.id}'`);
        }

        this.eventDef.off(this.listener);
    }

    /**
     * Bind to vue 'beforeDestroy' lifecycle so is cancelled when vue component is destroyed. It may be
     * that the underlying form or object managing the event handler will already properly dispose of
     * any registered event handlers. However, a handler might be created in a child vue component
     * which has a shorter lifecycle, in which case we want to remove handlers earlier
     *
     * @param vue
     */
    cancelOnDestroy(vue: VueComponent): this {
        if (!this._registeredWithVue) {
            vue.$once("hook:beforeDestroy", () => {
                eventSubscriptionLog.trace(`vue destroy: cancelling subscription '${this.id}'`);
                this.cancel();
            });

            this._registeredWithVue = true;
        }
        return this;
    }
}

type CancelFn = (reason: string) => undefined;
type EventWaitForFilter<T> = (event: T) => boolean;
type EventWaitForOptions<T> = Partial<Omit<ee2.WaitForOptions, "filter">> & {
    filter?: EventWaitForFilter<T>;
};

/**
 * Preserves the ability to chain the promise and still cancel it at the end of the chain
 */
class EventPromise<T> implements ee2.CancelablePromise<T> {
    constructor(private readonly cancelFn: CancelFn, private readonly delegate: Promise<T>) {}

    static from<T>(promise: ee2.CancelablePromise<T>): EventPromise<T> {
        return new EventPromise((reason) => {
            return promise.cancel(reason);
        }, promise);
    }

    /**
     * Cancel this promise
     * @param reason
     */
    cancel(reason: string): undefined {
        return this.cancelFn(reason);
    }

    then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined
    ): EventPromise<TResult1 | TResult2> {
        return this.wrap(this.delegate.then(onfulfilled, onrejected));
    }
    catch<TResult = never>(
        onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null | undefined
    ): EventPromise<T | TResult> {
        return this.wrap(this.delegate.catch(onrejected));
    }
    [Symbol.toStringTag]: string;
    finally(onfinally?: (() => void) | null | undefined): EventPromise<T> {
        return this.wrap(this.delegate.finally(onfinally));
    }

    private wrap<TType>(promise: Promise<TType>): EventPromise<TType> {
        // if the chain returns self, lets not create new instances
        const self = this as any;
        if (self === promise) {
            return self as EventPromise<TType>;
        }
        return new EventPromise(this.cancelFn, promise);
    }
}

/**
 * Defines an event anme and listener constract, with defaults options and a default emitter
 */
export class EventDef<TEventArgs extends {}> {
    constructor(
        readonly NAME: string,
        private readonly options: ee2.OnOptions,
        private readonly emitter: ee2.EventEmitter2
    ) {
        this.options = options;
    }

    /**
     * Add the given on listener, and return a subscription object which can be used to cancel the listener
     */
    subscribe(listener: EventListener<TEventArgs>, emitter?: ee2.EventEmitter2): EventSubscription {
        (emitter || this.emitter).on(this.NAME, listener, this.options);
        return new EventSubscription(this, listener);
    }

    /**
     * Add a listener to listen to this event
     * @param listener
     */
    on(listener: EventListener<TEventArgs>) {
        this.emitter.on(this.NAME, listener, this.options);
    }

    once(listener: EventListener<TEventArgs>) {
        this.emitter.once(this.NAME, listener, this.options);
    }

    off(listener: EventListener<TEventArgs>) {
        this.emitter.off(this.NAME, listener);
    }

    private toWaitForOptions<T>(options: EventWaitForOptions<T>): ee2.WaitForOptions {
        // adapt to the ee2 format
        const waitOptions = { ...options } as ee2.WaitForOptions;

        if (options.filter) {
            const firstArgFilter = options.filter;
            waitOptions.filter = (values: any[]) => firstArgFilter(values[0]);
        }
        if (options.handleError == undefined) {
            waitOptions.handleError = false;
        }
        if (options.timeout == undefined) {
            waitOptions.timeout = 0;
        }
        if (options.Promise == undefined) {
            waitOptions.Promise = Promise;
        }

        if (options.overload == undefined) {
            waitOptions.overload = false;
        }
        return waitOptions;
    }

    waitFor(options?: EventWaitForOptions<Event<TEventArgs>>): EventPromise<Event<TEventArgs>> {
        let waitOptions = options ? this.toWaitForOptions(options) : undefined;
        return EventPromise.from(this.emitter.waitFor(this.NAME, waitOptions)).then((values) => {
            return values[0];
        });
    }

    emit(args: TEventArgs, emitter?: ee2.EventEmitter2) {
        const event = { NAME: this.NAME, args: args } as Event<TEventArgs>;
        (emitter || this.emitter).emit(this.NAME, event);
    }

    async emitAsync(args: TEventArgs, emitter?: ee2.EventEmitter2) {
        const event = { NAME: this.NAME, args: args } as Event<TEventArgs>;
        return (emitter || this.emitter).emitAsync(this.NAME, event);
    }

    /**
     * Return a new eventDefinition using the given event emmitter
     */
    withEmmitter(emmitter: ee2.EventEmitter2): EventDef<TEventArgs> {
        return new EventDef(this.NAME, this.options, emmitter);
    }

    /**
     * Return a new eventDefinition using the following options
     */
    withOptions(options: ee2.OnOptions): EventDef<TEventArgs> {
        return new EventDef(this.NAME, options, this.emitter);
    }

    /**
     * Allow callers to perform their own operations on the underlying event emitter using this
     * event definition settings
     *
     * @param callback
     */
    apply(
        callback: (opts: {
            NAME: string;
            emmitter2: ee2.EventEmitter2;
            options: ee2.OnOptions;
            eventDef: EventDef<TEventArgs>;
        }) => void
    ) {
        callback({ NAME: this.NAME, eventDef: this, options: this.options, emmitter2: this.emitter });
    }
}

export function defineEvent<TEventArgs extends {} = {}>(name: string): EventDef<TEventArgs> {
    return EventDefaults.DEFAULT.defineEvent(name);
}
