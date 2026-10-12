import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe, it} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

interface SwitchQueryItem {
    kind: string;
    id: string;
    label: string;
}

interface SwitchQueryOptions {
    key: string;
    items: SwitchQueryItem[];
}

const loadSearchRegistration = () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/searchTab.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const queries: SwitchQueryOptions[] = [];
    const moduleExports: {registerSearchTab?: (tab: unknown) => void} = {};
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)})}},
        require: () => {
            throw new Error("search registration must not load subscription gates");
        },
    });
    const group = {
        switchQuery: (options: SwitchQueryOptions) => {
            queries.push(options);
        },
        number: (): undefined => undefined,
        switch: (): undefined => undefined,
    };
    moduleExports.registerSearchTab({group: () => group});
    return queries;
};

describe("search settings registration", () => {
    it("renders the asset path index switch without a subscription gate", () => {
        const queries = loadSearchRegistration();
        const index = queries.find((query) => query.key === "index");
        assert.ok(index);
        assert.equal(index.items.length, 1);
        assert.equal(index.items[0].kind, "switch");
        assert.equal(index.items[0].id, "search.indexAssetPath");
        assert.equal(index.items[0].label, "indexAssetPath");
    });
});

const searchAssetButton = /<span id="searchAsset" aria-label="\$\{window\.siyuan\.languages\.searchAssetContent\}" class="block__icon block__icon--show ariaLabel" data-position="9south">/;
const mobileAssetEntry = /<svg data-type="goAsset" class="toolbar__icon"><use xlink:href="#iconExact"><\/use><\/svg>/;

describe("asset search entry points", () => {
    it("renders the desktop asset search button without a subscription or disabled gate", () => {
        const source = readFileSync(resolve(process.cwd(), "src/search/util.ts"), "utf8");
        const button = source.match(searchAssetButton);
        assert.ok(button);
        assert.equal(source.includes("needSubscribe"), false);
        assert.equal(button[0].includes("disabled"), false);
        assert.equal(button[0].includes("fn__none"), false);
    });

    it("renders the mobile asset search entry without a subscription or disabled gate", () => {
        const source = readFileSync(resolve(process.cwd(), "src/mobile/menu/search.ts"), "utf8");
        const entry = source.match(mobileAssetEntry);
        assert.ok(entry);
        assert.equal(source.includes("needSubscribe"), false);
        assert.equal(entry[0].includes("disabled"), false);
        assert.equal(entry[0].includes("fn__none"), false);
    });
});
