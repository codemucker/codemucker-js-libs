/* eslint-disable */
// from https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript
export const hashCode = function (s: string) {
    var hash = 0
    for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i)
        hash |= 0 // Convert to 32bit integer
    }
    return hash
}

declare const window: any

const _isInBrowser = function () {
    try {
        if (typeof window === 'undefined') {
            return false
        }
        return true
    } catch (err) {
        return false
    }
}

export const isInBrowser = _isInBrowser()
export const isInNode = !isInBrowser

export const isBlank = function (value?: string) {
    return value == null || value == undefined || value.trim().length == 0
}

let idCounter = 1
/**
 * Return an id that is only unique for the current browser session (resets across reloads)
 */
export const newLocalId = function () {
    return `id-${idCounter++}-${Math.round(Math.random() * 10000)}`
}

/**
 * Return a promise that resolves in the given ms
 * @param ms
 */
export function delayMs(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
