/* eslint-disable */
import { isInNode } from './lang'

export enum LogLevel {
    TRACE = 1,
    DEBUG = 2,
    INFO = 3,
    WARN = 4,
    ERROR = 5,
    FATAL = 6,
    OFF = 7,
}

export type Level = LogLevel | string

const nameToLevel: { [name: string]: LogLevel } = {
    trace: LogLevel.TRACE,
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
    fatal: LogLevel.FATAL,
    off: LogLevel.OFF,
}

const levelToName = {
    [LogLevel.TRACE]: 'TRACE',
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.WARN]: ' WARN',
    [LogLevel.INFO]: ' INFO',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.FATAL]: 'FATAL',
    [LogLevel.OFF]: '  OFF',
}

const processLogLevel =
    process.env.VUE_APP_LOG_LEVEL || process.env.APP_LOG_LEVEL

const defaultLogLevel =
    nameToLevel[(processLogLevel || '').toLowerCase()] || LogLevel.INFO

function parseLevel(
    levelName: string,
    defaultLevel: LogLevel = defaultLogLevel
): LogLevel {
    return nameToLevel[(levelName || '').toLowerCase()] || defaultLevel
}

export interface Logger {
    level: Level
    isOff(): boolean
    isEnabled(): boolean
    isTraceEnabled(): boolean
    isDebugEnabled(): boolean
    isInfoEnabled(): boolean
    isWarnEnabled(): boolean
    isErrorEnabled(): boolean
    isFatalEnabled(): boolean
    isLevelEnabled(level: LogLevel): boolean

    trace(msg: any, ...args: any[]): void
    debug(msg: any, ...args: any[]): void
    info(msg: any, ...args: any[]): void
    warn(msg: any, ...args: any[]): void
    error(msg: any, ...args: any[]): void
    fatal(msg: any, ...args: any[]): void

    log(level: LogLevel, msg: string, ...args: any[]): void
    getLogger(childName: string): Logger
}

export interface LogFormatter {
    format(event: LogEvent): string
}

export interface LogAppender {
    append(event: LogEvent): void
}

class SimpleLogFormatter implements LogFormatter {
    format(event: LogEvent): string {
        const logName = levelToName[event.level]
        return `[${logName}] ${event.logName} - ${event.msg}`
    }
}

class ConsoleLogAppender implements LogAppender {
    private formatter: LogFormatter

    constructor(formatter: LogFormatter) {
        this.formatter = formatter
    }

    append(event: LogEvent): void {
        const line = this.formatter.format(event)

        if (event.level <= LogLevel.DEBUG) {
            console.debug(line, ...event.args)
        } else if (event.level == LogLevel.INFO) {
            console.info(line, ...event.args)
        } else if (event.level == LogLevel.WARN) {
            console.warn(line, ...event.args)
        } else {
            //TODO:generate a stacktrace without the logger code stack
            console.error(line, ...event.args)
        }
    }
}

export interface LogEvent {
    logName: string
    level: LogLevel
    msg: string
    args: any[]
}

class LoggerImpl implements Logger {
    private name: string
    _level: LogLevel | null
    private parent: LoggerImpl | null
    private appender: LogAppender | null

    constructor(
        name: string,
        level: LogLevel | null,
        appender: LogAppender | null,
        parent: LoggerImpl | null
    ) {
        this.name = name
        this._level = level
        this.parent = parent
        this.appender = appender
    }

    set level(level: Level) {
        if (typeof level === 'string') {
            level = parseLevel(level)
        }
        this._level = level
    }

    get level(): Level {
        return this._level
            ? this._level
            : this.parent
            ? this.parent.level
            : LogLevel.OFF
    }
    isTraceEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.TRACE)
    }
    isDebugEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.DEBUG)
    }
    isInfoEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.INFO)
    }
    isWarnEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.WARN)
    }
    isErrorEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.ERROR)
    }
    isFatalEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.FATAL)
    }
    isOff(): boolean {
        return this.isLevelEnabled(LogLevel.OFF)
    }
    isEnabled(): boolean {
        return !this.isOff()
    }
    isLevelEnabled(level: LogLevel): boolean {
        return this.level <= level
    }
    trace(msg: any, ...args: any[]) {
        this.log(LogLevel.TRACE, msg, args)
    }
    debug(msg: any, ...args: any[]) {
        this.log(LogLevel.DEBUG, msg, args)
    }
    info(msg: any, ...args: any[]) {
        this.log(LogLevel.INFO, msg, args)
    }
    warn(msg: any, ...args: any[]) {
        this.log(LogLevel.WARN, msg, args)
    }
    error(msg: any, ...args: any[]) {
        this.log(LogLevel.ERROR, msg, args)
    }
    fatal(msg: any, ...args: any[]) {
        this.log(LogLevel.FATAL, msg, args)
    }

    log(level: LogLevel, msg: string, ...args: any[]): void {
        if (this.isLevelEnabled(level)) {
            this.logEvent({
                logName: this.name,
                msg: msg,
                args: args,
                level: level,
            })
        }
    }

    private logEvent(logEvent: LogEvent): void {
        if (this.appender) {
            try {
                this.appender.append(logEvent)
            } catch (err) {
                console.log('[logger] Error invoking appender', { cause: err })
            }
        } else if (this.parent) {
            this.parent.logEvent(logEvent)
        }
    }

    getLogger(childName: string): Logger {
        return new LoggerImpl(
            `${this.name}.${childName}`,
            /*level*/ null,
            /*appender*/ null,
            this
        )
    }
}

export class LoggerFactory {
    private DEFAULT_FORMATTER = new SimpleLogFormatter()
    private DEFAULT_APPENDER = new ConsoleLogAppender(this.DEFAULT_FORMATTER)
    private DEFAULT_LEVEL = defaultLogLevel
    private DEFAULT_NAME = 'app'

    private _level: LogLevel = this.DEFAULT_LEVEL
    private _appender!: LogAppender | null
    private _rootName!: string | null

    private rootLogger = new LoggerImpl(
        this._rootName || this.DEFAULT_NAME,
        this._level || this.DEFAULT_LEVEL,
        this._appender || this.DEFAULT_APPENDER,
        null
    )

    set level(level: Level | undefined) {
        const existing = this.rootLogger.level
        this.rootLogger.level = level || this.DEFAULT_LEVEL
        if (existing != this.rootLogger.level) {
            // need to read it after as an invalid level might result in defaults
            console.log(
                `[logger] Default log level changed from ${
                    levelToName[existing]
                } to ${levelToName[this.rootLogger.level]}`
            )
        }
    }

    set rootName(name: string) {
        this._rootName = name
    }

    getLogger(name: string): Logger {
        return this.rootLogger.getLogger(name)
    }
}

let loggerFactory: LoggerFactory | undefined = undefined

function getOrCreateLogFactory() {
    if (!loggerFactory) {
        loggerFactory = new LoggerFactory()
        console.log(
            `[logger] using '${isInNode ? 'node' : 'browser'}' console logger`
        )
        console.log(
            `[logger] default log level is ${levelToName[defaultLogLevel]}`
        )
    }
    return loggerFactory
}

export function getLogger(name: string): Logger {
    return getOrCreateLogFactory().getLogger(name)
}

export function setLogLevel(level?: string): void {
    getOrCreateLogFactory().level = level
    levelSet = true
}

let levelSet = false
export function setLogLevelIfUnset(level?: string): void {
    if (levelSet) {
        return
    }
    setLogLevel(level)
}

export default getLogger
