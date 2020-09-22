export interface Link<TTarget, TTargetId> {
    value?: TTarget;
    readonly id: TTargetId;
}

export class Link<TTarget, TTargetId> implements Link<TTarget, TTargetId> {
    constructor(public readonly id: TTargetId) {}
    isLoaded() {
        return this.value ? true : false;
    }
}

export interface LinkMany<TTarget, TTargetId> extends Array<Link<TTarget, TTargetId>> {}

export class LinkMany<TTarget, TTargetId> extends Array<Link<TTarget, TTargetId>>
    implements LinkMany<TTarget, TTargetId> {
    constructor(links: Link<TTarget, TTargetId>[] = []) {
        super();
        this.push(...links);
    }

    isLoaded() {
        return this.find((link) => !link.isLoaded()) != undefined;
    }
}

// export interface LinkMany<TTarget, TTargetId> {
//     values?: TTarget[];
//     ids: TTargetId[];
// }

// ========== Vuetify ============
/**
 * These currently match the vuetify file upload control
 */
export interface FileInfo {
    readonly name: string;
    readonly type: string;
    readonly size: number;
    readonly contentEncoding: string;
    readonly lastModified: number;
    readonly lastModifiedDate: string;
}

export interface FileOf<TContent = any> extends FileInfo, File {}

export interface TextFile extends FileOf<string> {
    //content: string;
}
export class TextFile {}
export interface CsvTextFile extends TextFile {
    type: "text/csv";
}
export class CsvTextFile {}
