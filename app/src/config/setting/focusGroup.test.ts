import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

const load = () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/setting/focusGroup.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const moduleExports: {focusSettingGroup?: (root: unknown, groupId: string) => void} = {};
    runInNewContext(code, {
        exports: moduleExports,
        CSS: {escape: (value: string) => value},
    });
    return moduleExports.focusSettingGroup;
};

test("focusSettingGroup scrolls the matching group into view", () => {
    const scrolled: string[] = [];
    const groupElement = {scrollIntoView: (options: {block: string}) => scrolled.push(options.block)};
    const selectors: string[] = [];
    const root = {
        querySelector: (selector: string) => {
            selectors.push(selector);
            return selector.includes("providers") ? groupElement : null;
        },
    };
    load()(root, "providers");
    assert.deepEqual(scrolled, ["start"]);
    assert.deepEqual(selectors, ['[data-config-group-id="providers"]']);
});

test("focusSettingGroup ignores a missing group", () => {
    load()({querySelector: (): null => null}, "providers");
});
