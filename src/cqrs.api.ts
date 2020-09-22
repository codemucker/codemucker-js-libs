/* eslint-disable */
import _ from 'lodash'
import { v4 as uuid } from 'uuid'
import {
    Command,
    CommandResponse,
    CqrsApi,
    CqrsMessage,
    FindQuery,
    FindQueryResponse,
    GetQuery,
    GetQueryResponse,
} from './cqrs'
import { AppError, AppErrorOptions } from './errors'
import { hashCode } from './lang'
import { getLogger, Logger } from './logger'
import { extractFunctionDocs } from './util'

export {
    GetQuery,
    GetQueryResponse,
    FindQuery,
    FindQueryResponse,
    Command,
    CommandResponse,
    CqrsMessage,
    CqrsApi,
}

/**
 * Thrown to indicate there was an error in the cqrs api
 */
export class CqrsApiError extends AppError {
    constructor(opts: AppErrorOptions = {}, ctorFunc?: Function) {
        super(opts, ctorFunc || CqrsApiError)
    }
}

/**
 * Allow the api to pass down any additional information to handlers that are not
 * directly related to the message. Logs, reequest/response etc
 */

export interface MessageRequestContext {
    readonly message: CqrsMessage
    /**
     * The request logger to use
     */
    readonly log: Logger

    /**
     * The api to invoke for any additional in handler requests. Not gauranated to be the
     * same instance as the one the handler is running in (e.g. calls might be redirected,
     * queued etc)
     */
    readonly api: CqrsApi

    /**
     * Any additional request scope data
     */
    readonly data: { [key: string]: any }

    /**
     * If we are a nested call, the parent context
     */
    readonly parent?: MessageRequestContext

    /**
     * How far down the nested message invoke chain we are
     */
    readonly nestedDepth: number

    readonly contextId: string

    readonly requestId: string
}

export interface MessageHandler<
    TMessage extends CqrsMessage = CqrsMessage,
    TResponse = any
> {
    (message: TMessage, ctxt: MessageRequestContext): Promise<TResponse>
}

export interface PreMessageHandler {
    (message: CqrsMessage, ctxt: MessageRequestContext):
        | CqrsMessage
        | Promise<any>
}

export interface PostMessageHandler {
    (
        message: CqrsMessage,
        ctxt: MessageRequestContext,
        promise: Promise<any>
    ): Promise<any>
}

/**
 * Wrapper around an api implementation to prevent invoking admin methods on the
 * delegate api
 */

export class DelegatingCqrsApi implements CqrsApi {
    constructor(private readonly _delegate: CqrsApi) {}

    async invoke(message: CqrsMessage): Promise<any> {
        return await this._delegate.invoke(message)
    }

    async get<TCriteria, TResult>(
        query: GetQuery<TCriteria, TResult>
    ): Promise<GetQueryResponse<TResult>> {
        return await this._delegate.get(query)
    }

    async find<TCriteria, TResult>(
        find: FindQuery<TCriteria, TResult>
    ): Promise<FindQueryResponse<TResult>> {
        return await this._delegate.find(find)
    }

    async command<TPayload>(
        command: Command<TPayload>
    ): Promise<CommandResponse> {
        return await this._delegate.command(command)
    }
}

export class ApiHandlerRegistry {
    private readonly log = getLogger('cqrs.api')

    private handlersByMessageName: {
        [key: string]: MessageHandler
    } = {}

    readonly DEFAULT_NO_HANDLER: MessageHandler = (message: CqrsMessage) => {
        'Default no handler handler which returns an error message '
        return Promise.reject(
            new CqrsApiError({
                key: 'CQRS_API_NO_SUCH_HANDLER',
                message: `No handler was configured for message '${
                    message.messageName
                }' (type:${typeof message})`,
                details: 'see data for available handlers',
                data: {
                    registeredHandlers: _.keysIn(this.handlersByMessageName),
                },
            })
        )
    }

    private _noHandlerHandler: MessageHandler = this.DEFAULT_NO_HANDLER
    preHandlers: PreMessageHandler[] = []
    postHandler?: PostMessageHandler

    set noHandlerHandler(handler: MessageHandler) {
        this._noHandlerHandler = handler || this.DEFAULT_NO_HANDLER
    }

    /**
     * Return all the registered handlers
     */

    get handlers(): {
        [key: string]: MessageHandler
    } {
        return _.clone(this.handlersByMessageName)
    }

    get handlerNames(): string[] {
        return Object.keys(this.handlersByMessageName)
    }

    getHandler(messageName: string): MessageHandler | undefined {
        return this.handlersByMessageName[messageName]
    }

    getHandlerOrDefault(messageName: string): MessageHandler {
        const h = this.handlersByMessageName[messageName]
        if (h) {
            return h
        }
        this.log.trace(`No handler for '${messageName}', using default`)
        return this._noHandlerHandler
    }

    registerPreHandler(preHandler: PreMessageHandler) {
        this.preHandlers.push(preHandler)
    }

    registerFind<
        TCriteria,
        TResult,
        TQuery extends FindQuery<TCriteria, TResult>
    >(
        name: string,
        handler: MessageHandler<TQuery, FindQueryResponse<TResult>>
    ): this {
        this.register(name, handler as MessageHandler)
        return this
    }

    registerGet<
        TCriteria,
        TResult,
        TQuery extends GetQuery<TCriteria, TResult>
    >(
        name: string,
        handler: MessageHandler<TQuery, GetQueryResponse<TResult>>
    ): this {
        this.register(name, handler as MessageHandler)
        return this
    }

    registerCommand<TPayload, TCommand extends Command<TPayload>>(
        name: string,
        handler: MessageHandler<TCommand, CommandResponse>
    ): this {
        this.register(name, handler as MessageHandler)
        return this
    }

    register(name: string, handler: MessageHandler): this {
        this.log.trace(`Registering message handler for '${name}'`)
        this.handlersByMessageName[name] = handler
        return this
    }

    /**
     * Register a whole heap of handlrs at a time
     * @param handlers
     */
    registerHandlers(handlers: THandlers): this {
        _.forEach(handlers, (handler, name) => {
            this.register(name, handler as MessageHandler)
        })
        return this
    }
}

/**
 * Provides the api methods and passes all messages to a single method
 * to handle them (subclass to implement). This alleviates the need
 * to repeat the api surface all over the place
 */
abstract class ApiAdapter implements CqrsApi {
    async invoke(message: CqrsMessage): Promise<unknown> {
        return this.invokeHandler(message)
    }

    async get<TCriteria, TResult, TQuery extends GetQuery<TCriteria, TResult>>(
        query: TQuery
    ): Promise<GetQueryResponse<TResult>> {
        return this.invokeHandler(query)
    }

    async find<
        TCriteria,
        TResult,
        TQuery extends FindQuery<TCriteria, TResult>
    >(find: TQuery): Promise<FindQueryResponse<TResult>> {
        return this.invokeHandler(find)
    }

    async command<TPayload, TCommand extends Command<TPayload>>(
        command: TCommand
    ): Promise<CommandResponse> {
        return this.invokeHandler(command)
    }

    // implements this to handle any request
    protected abstract invokeHandler(message: CqrsMessage): Promise<any>
}

const logInternal = getLogger('cqrs.api.internal')
/**
 * Creates a new sub context when a handler invokes the api. This allows for handlers to make api calls, while still
 * preserving the curent request context (thought with a new message and depth)
 */
class NestableApi extends ApiAdapter implements CqrsApi {
    constructor(
        private readonly ctxtFactory: ContextFactory,
        private readonly messageInvoker: MessageHandlerInvoker,
        private readonly currentCtxt?: MessageRequestContext
    ) {
        super()
    }

    protected async invokeHandler(message: CqrsMessage): Promise<any> {
        //being called by a handler with an existing context
        const ctxt = this.ctxtFactory.newContext(message, this.currentCtxt)
        logInternal.trace('nested api call', {
            depth: ctxt.nestedDepth,
            message: message.messageName,
        })
        return this.messageInvoker.invokeHandlerFor(ctxt)
    }
}

interface ContextFactory {
    newContext(
        message: CqrsMessage,
        parent?: MessageRequestContext
    ): MessageRequestContext
}

const newId = function () {
    const id = hashCode(uuid())
    if (id < 0) {
        return (-id).toString()
    }
    return id.toString()
}
/**
 * Works in conjunction with the nestable api to correctly create nested contexts if handlers
 * invoke the api as part of handling a request
 */
class DefaultContextFactory implements ContextFactory {
    constructor(private readonly messageInvoker: MessageHandlerInvoker) {}

    newContext(
        message: CqrsMessage,
        parent?: MessageRequestContext
    ): MessageRequestContext {
        //we merge, so any parent customisations are kept. The parent might set the
        // request/response objects for example
        const requestId = parent ? parent.requestId : newId()
        const ctxt = {
            $type: 'DefaultContext',
            ...parent,
            ...({
                log: getLogger(`handler:${message.messageName}.${requestId}`),
                message: message,
                contextId: newId(),
                parent: parent,
                requestId: requestId,
                nestedDepth: parent ? parent.nestedDepth + 1 : 0,
                data: parent ? parent.data : {},
            } as MessageRequestContext),
        }
        ctxt.api = new NestableApi(this, this.messageInvoker, ctxt)
        return ctxt
    }
}

/**
 * Solves the chicken and egg problem of the handler invoker needs a context factory, and the context
 * factory needs the invoker
 */
class ContextFactoryShim implements ContextFactory {
    /**
     * What we will replace after the invoker is created
     */
    public delegate!: ContextFactory

    newContext(
        message: CqrsMessage,
        parent?: MessageRequestContext
    ): MessageRequestContext {
        return this.delegate.newContext(message, parent)
    }
}

export class BaseCqrsApi extends ApiAdapter implements CqrsApi {
    public readonly readonlyApi = new DelegatingCqrsApi(this)

    private readonly invoker: MessageHandlerInvoker
    private readonly ctxtFactory: ContextFactory

    constructor(public readonly registry = new ApiHandlerRegistry()) {
        super()
        const shim = new ContextFactoryShim()
        this.invoker = new MessageHandlerInvoker(registry, shim)
        this.ctxtFactory = new DefaultContextFactory(this.invoker)
        shim.delegate = this.ctxtFactory
    }

    /**
     * Invoke the handler for the given message, using the default created context. This
     * method is ultimately called by the various api methods
     *
     * @param message
     */
    async invokeHandler(message: CqrsMessage): Promise<any> {
        const ctxt = this.createContextFor(message)
        return this.invokeHandlerFor(ctxt)
    }

    /**
     * Invoke the handler using the passed in context
     * @param ctxt
     */
    async invokeHandlerFor(ctxt: MessageRequestContext): Promise<any> {
        return this.invoker.invokeHandlerFor(ctxt)
    }

    /**
     * Create a new context for the given message, using the ctxt options provided. This allows
     * for customisation of the context. All properties added will copied to nested contexts
     */
    createContextFor<TContextExtension>(
        message: CqrsMessage,
        ctxtOpts?: TContextExtension
    ): MessageRequestContext {
        const ctxt = this.ctxtFactory.newContext(message)
        if (ctxtOpts) {
            return { ...ctxt, ...ctxtOpts }
        }
        return ctxt
    }
}

interface MessageHandlerInvoker {
    invokeHandlerFor(ctxt: MessageRequestContext): Promise<any>
}

export const safeScrub = function (msg: CqrsMessage) {
    let s = JSON.stringify(msg)
    if (s.indexOf('assword') != -1) {
        s = JSON.stringify({ ...msg, payload: '***scrubbed***' })
    }
    return msg
}

export const safeScrubToJsonString = function (msg: CqrsMessage) {
    let s = JSON.stringify(msg)
    if (s.indexOf('assword') != -1) {
        s = JSON.stringify({ ...msg, payload: '***scrubbed***' })
    }
    return s
}
class MessageHandlerInvoker {
    private readonly log = getLogger('cqrs.api.BaseCqrsApi')

    constructor(
        private readonly registry: ApiHandlerRegistry,
        private readonly ctxtFactory: ContextFactory
    ) {}

    async invokeHandlerFor(ctxt: MessageRequestContext): Promise<any> {
        let message = ctxt.message
        try {
            const preHandlers = this.registry.preHandlers
            if (preHandlers.length > 0) {
                for (var i = 0; i < preHandlers.length; i++) {
                    if (this.log.isTraceEnabled()) {
                        this.log.trace(
                            `Invoking pre handler for '${message.messageName}'`,
                            safeScrub(message)
                        )
                    }
                    const preHandler = preHandlers[i]

                    let preResponse: any
                    try {
                        preResponse = await preHandler(message, ctxt)
                    } catch (err) {
                        this.log.error(
                            `Error running pre handler for message '${message?.messageName}'`,
                            {
                                handlerDocs: extractFunctionDocs(preHandler),
                                cause: err,
                                handler: `${preHandler}`,
                            }
                        )
                        throw err
                    }
                    if (!preResponse) {
                        // preHandler returned nothing, so stop processing. Assume it's done it's thing behind the scenes
                        this.log.trace('prehandler returned nothing, returning')
                        return
                    }
                    //the prehandler is circumnavigating the request pipeline
                    if (preResponse instanceof Promise) {
                        this.log.trace(
                            'prehandler returning promise, returning'
                        )
                        return preResponse
                    }
                    //not a message, so return the response as is
                    if (!(preResponse as any)?.messageName) {
                        this.log.trace(
                            'prehandler returning non message, returning as is'
                        )
                        return preResponse
                    }
                    if (message !== preResponse) {
                        this.log.trace(
                            'pre message handler changed the message ',
                            {
                                from: message.messageName,
                                to: preResponse.messageName,
                            }
                        )
                        ctxt = this.ctxtFactory.newContext(preResponse, ctxt)
                        message = preResponse
                    }
                }
            }
            const handler = this.registry.getHandlerOrDefault(
                message.messageName
            )
            if (this.log.isTraceEnabled()) {
                this.log.debug(
                    `invoking handler for '${message.messageName}'`,
                    safeScrub(message)
                )
            }
            let response = await handler(message, ctxt)

            if (this.registry.postHandler) {
                this.log.trace(`invoking post handler`)
                response = this.registry.postHandler(message, ctxt, response)
            }

            return response
        } catch (err) {
            // if (!(err instanceof CqrsApiError)) {
            //     err = new CqrsApiError({
            //         key: "CQRS_API_UNCAUGHT_ERROR",
            //         message: `Uncaught error handling message '${message?.messageName}'`,
            //         details: "see data for details",
            //         captureStack: true,
            //         data: {
            //             message: message,
            //             cause: err,
            //         },
            //         cause: err,
            //     });
            // }
            this.log.warn(
                `Handler for '${ctxt.message?.messageName}' returned error. Error message '${err.message}'. Returning a rejected promise`,
                {
                    cause: err,
                }
            )
            return Promise.reject(err)
        }
    }
}

export type THandlers = {}
