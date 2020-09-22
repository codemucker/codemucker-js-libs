/* eslint-disable */

/* eslint-disable */

import * as captureStackTrace from 'capture-stack-trace'
//import getLogger from '../logger.js'

/**
 * This file will be imported into client code. WARNING:Clinets, do not modify this file as it will be overwritten at the next generation run
 */
export interface AppErrorOptions {
    key?: string
    message?: string
    details?: string
    data?: { [key: string]: any }
    cause?: any
    captureStack?: boolean
}

//in node V8 this exists and also removes all stack frame after the first arg
const setStackTrace = Error['captureStackTrace'] || captureStackTrace
/**
 * Base of all errors.
 *
 * See https://www.bennadel.com/blog/2828-creating-custom-error-objects-in-node-js-with-error-capturestacktrace.htm
 *
 **/

export class AppError extends Error {
    readonly key?: string
    readonly details?: string
    readonly cause?: any
    readonly isAppError?: boolean
    readonly extendedInfo: { [key: string]: any }

    constructor(opts: AppErrorOptions, ctorFunc?: Function) {
        super(opts.key ? `${opts.key}: ${opts.message}` : opts.message)
        this.key = opts.key
        this.details = opts.details
        this.cause = opts.cause || null
        this.extendedInfo = opts.data ? opts.data : {}

        // flag that will indicate if the error is a custom AppError.
        this.isAppError = true
        if (opts.captureStack != false) {
            setStackTrace(this, ctorFunc || AppError)
        }
    }
}
