import { EventEmitter2 } from "eventemitter2";
import _ from "lodash";
import * as events from "./events";
import { getLogger } from "./logger";
import * as rules from "./rules";
import * as vue_tools from "./vue-tools";

const log = getLogger("forms");

const propertyLog = getLogger("forms.FormProperty");

export interface StorageProvider {
    getValue(key: string): string | undefined;
    setValue(key: string, value: string | undefined): void;
    removeValue(key: string): void;
}

export class NullStorageProvider implements StorageProvider {
    getValue(): string | undefined {
        return undefined;
    }
    setValue(): void {}
    removeValue() {}
}

let storage: StorageProvider = new NullStorageProvider();

/**
 * Set the storage provider to us. If undefined then use a no op one
 *
 *  @param provider Set the storage provider to us
 */
export function setStorageProvider(provider?: StorageProvider) {
    log.debug("set local storage provider", provider);
    storage = provider || new NullStorageProvider();
}
/**
 * Used by the auto forma layout engine
 */

/**
 * Defines a basic form to display in a UI. Allproeprties are prefixed with '$' to prevtn any clashes
 * with property name on the models
 */
export interface Form {
    /**
     * Programmatic, logical and logging name of the form
     */
    $formName: string;

    /**
     * Form title to be displayed
     */
    $title: string;

    /**
     * Additional form level rules
     */
    $rules: rules.ValidationRule[];

    /**
     * Marked to indicate the form is valid or not
     */
    $valid: boolean;

    /**
     * Any form level errors. Set and cleared by validation
     */
    $formErrors: string[];

    /**
     * Whether validation errors are currently displayed or not for all the fields
     */
    $showValidationErrors: boolean;

    $events: EventEmitter2;

    /**
     * see https://vuejs.org/v2/guide/reactivity.html#Change-Detection-Caveats
     */
    $clearErrors(): void;
}

export interface PropertiesForm extends Form {
    readonly $properties: FormProperty<any>[];
}

type EmitterFactory = () => EventEmitter2;

let defaultEmitterFactory: EmitterFactory = (maxListeners = 50) =>
    new EventEmitter2({ maxListeners: maxListeners, verboseMemoryLeak: true });

export const setDefaultEmitter = function (factory: EmitterFactory) {
    defaultEmitterFactory = factory;
};

export class PropertiesForm implements PropertiesForm {
    readonly $type = "UIForm";

    readonly $formName: string;
    $title: string;
    readonly $properties: FormProperty<any>[] = [];
    readonly $rules: rules.ValidationRule[];
    readonly $events = defaultEmitterFactory();
    readonly $submitEvent = formSubmitEvent.withEmmitter(this.$events);
    readonly $beforeSubmitEvent = formBeforeSubmitEvent.withEmmitter(this.$events);
    readonly $cancelEvent = formCancelEvent.withEmmitter(this.$events);
    readonly $resetEvent = formResetEvent.withEmmitter(this.$events);
    readonly $clearErrorsEvent = formClearErrorsEvent.withEmmitter(this.$events);
    readonly $validateEvent = formValidateEvent.withEmmitter(this.$events);
    readonly $afterValidatedEvent = formAfterValidatedEvent.withEmmitter(this.$events);

    readonly $propertyChangeEvent = formPropertyChangedEvent.withEmmitter(this.$events);

    $subForms: PropertiesForm[] = [];

    constructor(opts: { title: string; formName: string; rules?: rules.ValidationRule[] }) {
        this.$formName = opts.formName;
        this.$title = opts.title;
        this.$rules = opts.rules || [];
        //seems cto doesnt work??
        this.$events.setMaxListeners(50);
    }

    /** Fiddled with during runtime validation */
    $valid: boolean = false;
    $formErrors: string[] = [];
    $showValidationErrors: boolean = false;

    newProperty<T>(opts: Omit<FormPropertyOptions, "form">): FormProperty<T> {
        const p = new FormProperty<T>(_.merge({}, opts, { form: this }));
        this.$properties.push(p);
        return p;
    }

    addSubForm(form: PropertiesForm) {
        //TODO:check not already added?
        this.$subForms.push(form);
    }

    removeSubForm(form: PropertiesForm) {
        this.$subForms = this.$subForms.filter((f) => f !== form);
    }

    addFormRule(rule: rules.ValidationRule): this {
        this.$rules.push(rule);
        return this;
    }

    /**
     * Allow for chaining when creating the form
     * @param mutator
     */
    apply(mutator: (form: this) => void): this {
        mutator(this);
        return this;
    }

    clone(opts: { title?: string }): PropertiesForm {
        const formOpts = _.merge({ title: this.$title, formName: this.$formName, rules: [...this.$rules] }, opts);

        const form = new PropertiesForm(formOpts);
        this.$properties.forEach((p) => {
            form.$properties.push(p.clone({ form: form }));
        });
        this.$subForms.forEach((f) => {
            form.addSubForm(f.clone({}));
        });
        return form;
    }

    /**
     * see https://vuejs.org/v2/guide/reactivity.html#Change-Detection-Caveats
     */
    $clearErrors() {
        this.invokeSubForms((f) => f.$clearErrors());
        vue_tools.emptyArray(this.$formErrors);
        this.$clearErrorsEvent.emit({ form: this });
    }

    $cancel() {
        this.invokeSubForms((f) => f.$cancel());
        this.$cancelEvent.emit({ form: this });
    }

    $reset() {
        this.$properties.forEach((p) => {
            p.reset();
        });
        this.invokeSubForms((f) => f.$reset());
        this.$resetEvent.emit({ form: this });
    }

    $setReadonly(flag = true) {
        this.$properties.forEach((p) => {
            p.readonly = flag;
        });
    }

    $validate() {
        //TODO: call each property validate
        this.invokeSubForms((f) => f.$validate());
        this.$validateEvent.emit({ form: this });
    }

    $afterValidated() {
        //TODO: call each property validate
        this.invokeSubForms((f) => f.$afterValidated());
        this.$afterValidatedEvent.emit({ form: this });
    }

    $beforeSubmit() {
        this.invokeSubForms((f) => f.$beforeSubmit());
        this.$beforeSubmitEvent.emit({ form: this });
    }

    $submit() {
        this.invokeSubForms((f) => f.$submit());
        this.$submitEvent.emit({ form: this });
    }

    private invokeSubForms(invoker: (form: PropertiesForm) => void) {
        if (this.$subForms.length == 0) {
            return;
        }
        this.$subForms.forEach((f) => invoker(f));
    }
}

export interface PropertyConstraint {
    name: string;
}

/**
 * Not really used atm. Delete?
 */
export enum PropertyFlags {
    None = 0,
    IsValueType = 1 << 0,
    IsReference = 1 << 1,
    IsMany = 1 << 2,
    IsList = 1 << 3,
    IsSet = 1 << 4,
    IsMap = 1 << 5,
    IsDate = 1 << 6,
    IsUnique = 1 << 7,
    IsNumber = 1 << 8,
    IsString = 1 << 9,
    IsArray = 1 << 10,
    IsBoolean = 1 << 11,
    IsEnum = 1 << 12,
    IsRequired = 1 << 13,
    IsReadonly = 1 << 14,
    IsFile = 1 << 15,
}

export module PropertyFlags {
    /**
     * IL Model full generic types to flags
     */
    const typeMap: { [type: string]: PropertyFlags } = {
        string: 0 | PropertyFlags.IsValueType | PropertyFlags.IsString,
        "string:email": 0 | PropertyFlags.IsValueType | PropertyFlags.IsString,
        "string:id": 0 | PropertyFlags.IsValueType | PropertyFlags.IsString,
        "string:password": 0 | PropertyFlags.IsValueType | PropertyFlags.IsString,
        "string:multiline": 0 | PropertyFlags.IsValueType | PropertyFlags.IsString,
        date: 0 | PropertyFlags.IsValueType | PropertyFlags.IsDate,
        number: 0 | PropertyFlags.IsValueType | PropertyFlags.IsNumber,
        Array: 0 | PropertyFlags.IsValueType | PropertyFlags.IsArray,
        List: 0 | PropertyFlags.IsArray | PropertyFlags.IsList,
        enum: 0 | PropertyFlags.IsValueType | PropertyFlags.IsEnum,
        file: 0 | PropertyFlags.IsFile,
        "file:text": 0 | PropertyFlags.IsFile,
        "file:text:csv": 0 | PropertyFlags.IsFile,
        "file:binary": 0 | PropertyFlags.IsFile,
        "List<file>": 0 | PropertyFlags.IsFile | PropertyFlags.IsArray | PropertyFlags.IsList,
        "List<file:text:csv>": 0 | PropertyFlags.IsFile | PropertyFlags.IsArray | PropertyFlags.IsList,
        "List<file:binary>": 0 | PropertyFlags.IsFile | PropertyFlags.IsArray | PropertyFlags.IsList,
        "List<string>": 0 | PropertyFlags.IsArray | PropertyFlags.IsList,
        "Set<string>": 0 | PropertyFlags.IsSet | PropertyFlags.IsList,
    };

    export function fromType(type: string): PropertyFlags {
        /**
         * Just read the prefix if no matches
         */
        const flags = typeMap[type];
        return flags == undefined ? PropertyFlags.IsString : flags;
    }
}

export interface FormPropertyOptions {
    form: PropertiesForm;
    name: string;
    label?: string;
    /**
     * Default value
     */
    default?: unknown;
    /**
     * Any further constraints, above the rules
     */
    constraints?: PropertyConstraint[];
    /**
     * Validation rules
     */
    rules?: rules.Rule<any>[];

    readonly?: boolean;

    /**
     * If true, then the value will be saved to local storage
     */
    remember?: boolean;
    /**
     * Local storage remember value key.  If not set, will use default (fullKey with prefix)
     */
    localStorageKey?: string;
    /**
     * Type of the value
     */
    type?: string;
    flags?: PropertyFlags;
    /**
     * If true, don't show to user as they type
     */
    masked?: boolean;
    /**
     * If true, don't dispaly on ui
     */
    hidden?: boolean;
    /**
     * Essentially the tool tip. Can be a locations key
     */
    hint?: string;
    /**
     * A longer description if the user clicks on an info icon. Can be a locations key
     */
    description?: string;

    /**
     * Any additonal meta information
     */
    meta?: { [key: string]: any };

    tabIndex?: number;
    autoFocus?: boolean;
    /**
     * Formats a value as it's input
     */
    formatter?: PropertyValueFormatter;
}

export type PropertyValueFormatter = (value: any) => any;
export type PropertyCloneOptions = Partial<FormPropertyOptions>;

export class FormProperty<TValue> {
    readonly $type = "FormProperty";

    static readonly RULE_REQUIRED_KEY = rules.required().key;
    static readonly STORAGE_DEFAULT_PREFIX = "forms.remember.";

    private readonly _form: PropertiesForm;
    private _value?: TValue;
    private readonly _fullName: string;
    private readonly _name: string;

    private _rules: rules.Rule<TValue>[];
    private readonly _valueType: string;
    private readonly _flags: number;

    defaultValue?: TValue;
    label: string;
    readonly: boolean;
    masked: boolean;
    hidden: boolean;
    description?: string;
    hint?: string;
    tabIndex?: number;
    autoFocus?: boolean;

    remember: boolean;

    _localStorageKey: string;
    meta: { [key: string]: any };

    formatter?: PropertyValueFormatter;

    constructor(opts: FormPropertyOptions) {
        this._form = opts.form;
        this._name = opts.name;
        this._fullName = `${opts.form.$formName}.${opts.name}`;
        this._value = opts.default as TValue;
        // copy, so different instantiations of this property won't modify other instantiations
        this._rules = opts.rules ? [...opts.rules] : [];
        this.defaultValue = opts.default as TValue;
        this._valueType = opts.type || "string";
        this._flags = opts.flags == undefined ? PropertyFlags.fromType(this.valueType) : opts.flags;
        this.masked = opts.masked == true || false;
        this.hidden = opts.hidden == true || false;
        this.label = opts.label || this.name;
        this.readonly = opts.readonly == true || false;
        this.description = opts.description;
        this.hint = opts.hint;
        this.tabIndex = opts.tabIndex;
        this.autoFocus = opts.autoFocus;

        this.remember = opts.remember == true || false;
        this._localStorageKey = opts.localStorageKey || FormProperty.STORAGE_DEFAULT_PREFIX + this.fullname;

        this.meta = opts.meta || {};
        this.formatter = opts.formatter;

        if (this.remember) {
            try {
                this.loadFromLocalStore();
            } catch (err) {
                propertyLog.warn(
                    `Error loading property '${this.fullname} from local store using key '${this.localStorageKey}'`,
                    err
                );
            }
        }

        formSubmitEvent.on(() => {
            if (!this.remember) {
                return;
            }
            try {
                this.saveToLocalStore();
            } catch (err) {
                propertyLog.warn(
                    `Error loading property '${this.fullname} from local store using key '${this.localStorageKey}'`,
                    err
                );
            }
        });
    }

    get $onChangeEvent() {
        return this.form.$propertyChangeEvent as events.EventDef<PropertyChangeEventArgs<TValue>>;
    }

    loadFromLocalStore() {
        if (this.localStorageKey) {
            try {
                const val = storage.getValue(this.localStorageKey);
                //todo:auto convert (ok for string values atm)
                // we don't want to trigger an initial property change event, hence setting directly
                // and bypassing the event mechanism
                this._value = val as any;
            } catch (err) {
                propertyLog.warn(
                    `Error loading property '${this.fullname} from local store using key '${this.localStorageKey}'`,
                    err
                );
            }
        }
    }

    saveToLocalStore() {
        if (this.localStorageKey) {
            storage.setValue(this.localStorageKey, this.value ? `${this.value}` : undefined);
        }
    }

    /**
     * Clone this property
     *
     * @param opts any property options to override
     */
    clone(opts: PropertyCloneOptions): FormProperty<TValue> {
        const merged = _.merge(
            {
                form: this.form,
                hidden: this.hidden,
                name: this.name,
                label: this.label,
                hint: this.hint,
                description: this.description,
                default: this.defaultValue,
                flags: this.flags,
                localStorageKey: this.localStorageKey,
                remember: this.remember,
                masked: this.masked,
                readonly: this.readonly,
                rules: [...this.rules],
                type: this.$type,
                meta: _.clone(this.meta),
                formatter: this.formatter,
            } as FormPropertyOptions,
            opts
        );
        return new FormProperty(merged);
    }

    get name(): string {
        return this._name;
    }

    get form(): PropertiesForm {
        return this._form;
    }

    get flags(): PropertyFlags {
        return this._flags;
    }

    get fullname(): string {
        return this._fullName;
    }

    get value(): TValue | undefined {
        return this._value;
    }

    get required() {
        return _.find(this._rules, (r) => r.key == FormProperty.RULE_REQUIRED_KEY) != undefined;
    }

    set required(value) {
        // this will also remove duplicate 'required' rules
        _.remove(this._rules, (r) => r.key == FormProperty.RULE_REQUIRED_KEY);
        if (value) {
            this._rules = [rules.required(), ...this._rules];
        }
    }

    get valueOrError(): TValue {
        const val = this.value;
        if (val != undefined) {
            return val;
        }
        throw `Value for property '${this.fullname}' is not set`;
    }

    set value(value: TValue | undefined) {
        this.set(value);
    }

    get rules(): rules.Rule<TValue>[] {
        return this._rules;
    }

    get valueType(): string {
        return this._valueType;
    }

    get localStorageKey(): string {
        return this._localStorageKey;
    }

    set(value: TValue | undefined) {
        if (this.readonly || value == this._value || value === this._value) {
            return;
        }
        if (propertyLog.isTraceEnabled()) {
            propertyLog.trace("set property", {
                from: this.value,
                to: value,
                propertyName: this.name,
                fullPropertyName: this.fullname,
            });
        }
        const oldValue = this._value;
        this._value = value;
        this.$onChangeEvent.emit({
            property: this,
            value: this.value,
            oldValue: oldValue,
        });
    }

    get(): TValue | undefined {
        return this.value;
    }

    reset() {
        this.value = this.defaultValue;
    }

    isSet() {
        return this._value != undefined;
    }

    isString() {
        return this.hasFlag(PropertyFlags.IsString);
    }

    isNumber() {
        return this.hasFlag(PropertyFlags.IsNumber);
    }

    isBoolean() {
        return this.hasFlag(PropertyFlags.IsBoolean);
    }

    isDate() {
        return this.hasFlag(PropertyFlags.IsDate);
    }

    isList() {
        return this.hasFlag(PropertyFlags.IsList);
    }

    isMap() {
        return this.hasFlag(PropertyFlags.IsMap);
    }

    isReference() {
        return this.hasFlag(PropertyFlags.IsReference);
    }

    hasFlag(flag: PropertyFlags): boolean {
        return (this._flags & flag) != 0;
    }
}

type PropertyChangeEventArgs<TValue> = { property: FormProperty<TValue>; oldValue?: TValue; value?: TValue };

export const formCancelEvent = events.defineEvent<{ form: Form }>("form.FormCancelEvent");
export const formResetEvent = events.defineEvent<{ form: Form }>("form.FormResetEvent");
export const formClearErrorsEvent = events.defineEvent<{ form: Form }>("form.FormClearErrorsEvent");
export const formBeforeSubmitEvent = events.defineEvent<{ form: Form }>("form.FormBeforeSubmitEvent");
export const formSubmitEvent = events.defineEvent<{ form: Form }>("form.FormSubmitEvent");
// should this be vetoable?
export const formValidateEvent = events.defineEvent<{ form: Form }>("form.FormValidateEvent");
// hmm, should we let consumer decide? And should the 'validated' be after tha fact?
export const formAfterValidatedEvent = events.defineEvent<{ form: Form }>("form.FormAfterValidatedEvent").withOptions({
    //free up the UI as user types
    nextTick: true,
});
export const formPropertyChangedEvent = events
    .defineEvent<PropertyChangeEventArgs<unknown>>("form.FormPropertyChangedEvent")
    .withOptions({
        //free up the UI as user types
        nextTick: true,
    });
