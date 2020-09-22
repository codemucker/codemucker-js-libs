import passwordStrength from "check-password-strength";
import _ from "lodash";
import * as i18n from "./i18n";
import { getLogger } from "./logger";
import { FileInfo } from "./types.js";

const rulesLog = getLogger("rules");

/**
 * The result of validation
 */
export type ValidationResult = string | boolean;
/**
 * Runs a validation check agasint the given value and returns a validation result
 */
export type ValidationRule = (value: any) => ValidationResult;

export interface Rule<TValue = any> {
    /**
     * Unique key of this rule. Also used to locate localisation messages
     */
    key: string;
    /**
     * The values used to create this rule.
     */
    expects: { [key: string]: any };
    /**
     * Invoke the rule validator with the given field value. The rule will have to perform any null checks
     */
    (fieldValue: TValue): ValidationResult;
}

/**
 * Create a new rule
 *
 * @param opts
 */
export function newRule<TValue = any>(opts: {
    /** Unique error key for lookup by other tools */
    key: string;
    /** The error message template */
    errorMsgTemplate: string;
    /** The values used to configure this rule */
    expect?: { [key: string]: any };
    singular: boolean;
    /** What performs the actual test whether the value passes the check */
    matcher: (value: TValue | undefined | null) => boolean | string;
    /** Optional converter to convert the incoming value to the type this rule requires */
    valueConverter?: (value: any) => TValue | undefined;
    /** Optional conveter to convert the expected values into something suitable for the error templates */
    convertErrorArgs?: (args: { [key: string]: any } & { actual: any }) => {};
}): Rule<TValue> {
    const key = opts.key;
    // provide the ability to override the default templates
    const errorMsgTemplate = i18n.getOr(key, opts.errorMsgTemplate);
    const convertErrorArgs = opts.convertErrorArgs;
    const matcher = opts.matcher;
    const expects = opts.expect || {};
    //the function which gets called to validate a rule
    const rule = <Rule<TValue>>function (value: TValue) {
        const result = matcher(value);
        if (result == true) {
            return true;
        }
        if (typeof result == "string") {
            return result;
        }
        rulesLog.trace("rule failed", key, value);
        const mergedArgs = _.merge({}, expects, { actual: value });
        const errorArgs = convertErrorArgs ? convertErrorArgs(mergedArgs) : mergedArgs;

        try {
            return errorMsgTemplate(errorArgs);
        } catch (err) {
            rulesLog.error("Error creating error mesage", {
                key,
                errorArgs,
                err,
            });
            return "Invalid";
        }
    };
    // allow other tools/UI to determine what rules are in force
    rule.key = opts.key;
    rule.expects = expects;

    return rule;
}

function isNullOrUndefined<T>(value: T | undefined | null): value is undefined | null {
    return value == undefined || value == null;
}

export function required(): Rule<any> {
    return newRule<any>({
        key: "required",
        errorMsgTemplate: "Value is required",
        singular: false,
        matcher: (value) => !isNullOrUndefined(value),
    });
}

export function email(): Rule<string> {
    const re = RegExp(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    return newRule({
        key: "string:email",
        errorMsgTemplate: "Expect a valid email address",
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || re.test(value),
    });
}

export function minLength(min: number): Rule<string> {
    return newRule({
        key: "string:minLength",
        errorMsgTemplate: "Expect at least ${min} characters",
        expect: { min },
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || value.toString().trim().length >= min,
    });
}

export function maxLength(max: number): Rule<string> {
    return newRule({
        key: "string:maxLength",
        errorMsgTemplate: "Expect a maximum of ${max} characters",
        expect: { max },
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || value.toString().trim().length <= max,
    });
}

function toUnitsSize(bytes: number) {
    let units = " bytes";
    let sizeInUnits = bytes;
    if (bytes >= 1e9) {
        units = "gB";
        sizeInUnits = bytes / 1e9;
    } else if (bytes >= 1e6) {
        units = "mB";
        sizeInUnits = bytes / 1e6;
    } else if (bytes >= 1e3) {
        units = "kB";
        sizeInUnits = bytes / 1e3;
    }

    return { units, sizeInUnits: sizeInUnits.toPrecision(3) };
}

export function minFileSize(minBytes: number): Rule<FileInfo> {
    const min = toUnitsSize(minBytes);

    return newRule({
        key: "file:minSize",
        errorMsgTemplate: "Expect a minium size of ${minInUnits}${units}",
        expect: { units: min.units, minInUnits: min.sizeInUnits },
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || value.size >= minBytes,
    });
}

export function maxFileSize(maxBytes: number): Rule<FileInfo> {
    const max = toUnitsSize(maxBytes);

    return newRule({
        key: "file:maxSize",
        errorMsgTemplate: "Expect a maximum size of ${maxInUnits}${units}",
        expect: { units: max.units, maxInUnits: max.sizeInUnits },
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || value.size <= maxBytes,
    });
}

export function fileContentEncoding(encoding: string): Rule<FileInfo> {
    return newRule({
        key: "file:contentEncoding",
        errorMsgTemplate: "Expect a content encoding of '${encoding}'",
        expect: { encoding },
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || value.contentEncoding == encoding,
    });
}

/**
 * The file content media encoding to
 *
 * @param mediaType
 */
export function fileContentMediaType(mediaType: string): Rule<File> {
    return newRule({
        key: "file:contentMediaType",
        errorMsgTemplate: "Expect a content type of '${mediaType}'",
        expect: { mediaType },
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || value.type == mediaType,
    });
}

export function pattern(pattern: string | RegExp): Rule<string> {
    let re: RegExp;
    if (typeof pattern === "string") {
        re = RegExp(pattern);
    } else {
        re = pattern;
    }
    return newRule({
        key: "string:pattern",
        errorMsgTemplate: "Expect matches pattern ${pattern}",
        expect: { pattern: re.source },
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || re.test(value),
    });
}

export function singleLine(): Rule<string> {
    return newRule({
        key: "string:singleLine",
        errorMsgTemplate: "Expect a single line",
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || value.split("\r\n").length <= 1,
    });
}

export function maxLines(max: number): Rule<string> {
    return newRule({
        key: "string:maxLines",
        errorMsgTemplate: "Expect no more than ${max} lines",
        expect: { max },
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || value.split("\r\n").length <= max,
    });
}

export function oneOf(values: string[]): Rule<string> {
    return newRule({
        key: "string:oneOf",
        errorMsgTemplate: "Expect one of [${values}] lines",
        convertErrorArgs: (args) => {
            return { values: args.values.map((v: unknown) => `'${v}'`).join(",") };
        },
        expect: { values },
        singular: true,
        matcher: (value) => isNullOrUndefined(value) || _.includes(values, value),
    });
}

export function minItems(min: number): Rule<string[]> {
    return newRule({
        key: "list:minItems",
        errorMsgTemplate: "Expect at least ${min} items",
        expect: { min },
        singular: false,
        matcher: (value) => isNullOrUndefined(value) || value.length >= min,
    });
}

export function maxItems(max: number): Rule<string[]> {
    return newRule({
        key: "list:maxItems",
        errorMsgTemplate: "Expect no more than ${max} items",
        expect: { max },
        singular: false,
        matcher: (value) => isNullOrUndefined(value) || value.length <= max,
    });
}

/**
 * Apply each of the passed in rules to each item in the list of values
 * @param rules
 */
export function eachItem<T>(...rules: Array<Rule<T>>): Rule<Array<T>> {
    return newRule<Array<T>>({
        key: "list:all",
        errorMsgTemplate: "Expect rules to pass for each item",
        expect: { rules: rules },
        singular: false,
        matcher: (values) => {
            if (isNullOrUndefined(values)) {
                return true;
            }
            for (let i = 0; i < values.length; i++) {
                const val = values[i];
                for (let j = 0; j < rules.length; j++) {
                    const rule = rules[j];
                    try {
                        const result = rule(val);
                        if (result != true) {
                            return `Item ${i + 1} is invalid. ${result}`;
                        }
                    } catch (err) {
                        return `Item ${i + 1} is invalid. ${err}`;
                    }
                }
            }
            return true;
        },
    });
}

export function minVal(min: number): Rule<number | string> {
    return newRule<number | string>({
        key: "number:min",
        errorMsgTemplate: "Expect a min value of ${min}",
        expect: { min },
        singular: true,
        valueConverter: (value: any): number | undefined => {
            if (isNullOrUndefined(value)) {
                return undefined;
            }
            if (typeof value === "number") {
                return value;
            }
            return parseInt(value.toString());
        },
        matcher: (value) => isNullOrUndefined(value) || value >= min,
    });
}

export function maxVal(max: number): Rule<number | string> {
    return newRule<number | string>({
        key: "number:max",
        errorMsgTemplate: "Expect a max value of ${max}",
        expect: { max },
        singular: true,
        valueConverter: (value: any): number => {
            if (value == undefined || typeof value === "number") {
                return value;
            }
            return parseInt(value.toString());
        },
        matcher: (value) => isNullOrUndefined(value) || value <= max,
    });
}

export function password(): Rule<string> {
    return newRule({
        key: "string:password",
        errorMsgTemplate:
            "Expect a suitably complex password password. Need Uppercase, LowerCase, Number and special character and 8 or more chars",
        expect: { value: "[A-Z]+[a-z]+[0-9]+[!$#%^&*()]+" },
        singular: true,
        matcher: (value) =>
            // password check returns 'Weak','Medium','Strong'
            isNullOrUndefined(value) || value.trim().length <= 8 || passwordStrength(value).value != "Strong",
    });
}

export function unknown(constraintKey: string, constraintVal: any): Rule<any> {
    rulesLog.warn("unknown constraint", constraintKey, constraintVal);
    return newRule({
        key: "unknown",
        errorMsgTemplate: "unknown constraint '${constraintKey}' with value '${constraintVal}'",
        expect: { constraintKey, constraintVal },
        singular: false,
        matcher: () => true,
    });
}
