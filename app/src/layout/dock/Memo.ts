import dayjs from "dayjs";
import {Tab} from "../Tab";
import {bindPanelSearch} from "./panelSearch";
import {Model} from "../Model";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";
import {decodeInlineMemoContent, encodeInlineMemoContent} from "../../protyle/util/inlineMemo";
import {updateTransaction} from "../../protyle/wysiwyg/transaction";
import type {App} from "../../index";
import {Constants} from "../../constants";
import {checkFold} from "../../util/noRelyPCFunction";
import {escapeAttr, escapeHtml} from "../../util/escape";

interface IInlineMemoItem {
    blockID: string;
    indexes: number[]; // 块内组成该条备注的 span 序号（应用备注时按格式边界拆分的片段）
    anchor: string; // 划线文本
    memo: string; // 备注内容
}

interface IMemoGroup extends IInlineMemoItem {
    rawAttr: string; // 归并用的原始属性值
    lastSpan: Element;
}

const ANCHOR_LIMIT = 80;

// 两个 span 是否相邻（中间只允许空文本或零宽空格），用于归并同一条备注的拆分片段
const isAdjacentMemoSpan = (previous: Element, current: Element) => {
    let node = previous.nextSibling;
    while (node && node !== current) {
        if (node.nodeType === 3 && (node.textContent || "").split(Constants.ZWSP).join("") !== "") {
            return false;
        }
        if (node.nodeType === 1) {
            return false;
        }
        node = node.nextSibling;
    }
    return node === current;
};

export class Memo extends Model {
    private element: HTMLElement;
    private listElement: HTMLElement;
    private data: IInlineMemoItem[] = [];
    private protyle: IProtyle;
    private rootID = "";

    constructor(app: App, tab: Tab) {
        super({app});
        this.connect({
            id: tab.id,
            type: "memo",
            msgCallback: this.handleMsgCallback.bind(this)
        });
        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__memo", "dockPanel");
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo fn__flex-1">${window.siyuan.languages.memo}</div>
    <input spellcheck="false" class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.searchPlaceholder}" />
    <span data-type="search" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.search}"><svg><use xlink:href='#iconSearch'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1"></div>`;
        this.listElement = this.element.lastElementChild as HTMLElement;
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const showSearch = bindPanelSearch(inputElement,
            this.element.querySelector('[data-type="search"]') as HTMLElement, () => this.render());
        this.element.addEventListener("click", (event) => {
            if ((event.target as HTMLElement).tagName === "INPUT" ||
                (event.target as HTMLElement).tagName === "TEXTAREA") {
                return;
            }
            setPanelFocus(this.element);
            const iconElement = hasClosestByClassName(event.target as HTMLElement, "block__icon");
            if (iconElement) {
                const type = iconElement.getAttribute("data-type");
                switch (type) {
                    case "min":
                        getDockByType("memo")?.toggleModel("memo", false, true);
                        break;
                    case "refresh":
                        this.update();
                        break;
                    case "search":
                        showSearch();
                        break;
                }
                return;
            }
            const cardElement = hasClosestByClassName(event.target as HTMLElement, "memo-card");
            if (!cardElement) {
                return;
            }
            if (hasClosestByClassName(event.target as HTMLElement, "memo-card__content")) {
                this.startEdit(cardElement);
                return;
            }
            const id = cardElement.getAttribute("data-node-id");
            checkFold(id, (zoomIn, action: TProtyleAction[]) => {
                openFileById({
                    app,
                    id,
                    action: action || [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                    zoomIn
                });
            });
        });
        this.update();
    }

    private handleMsgCallback(data: IWebSocketData) {
        if (data?.cmd === "savedoc" && this.rootID && data.data?.rootID === this.rootID) {
            this.update();
        }
    }

    public update(protyle?: IProtyle) {
        if (protyle !== undefined) {
            this.protyle = protyle;
            this.rootID = protyle?.block?.rootID || "";
        }
        if (!this.protyle || !this.rootID || !this.protyle.element.isConnected ||
            this.protyle.block.rootID !== this.rootID) {
            this.data = [];
            this.render();
            return;
        }
        // 同一备注在应用时会被拆成相邻的多个 span（格式边界），这里按块 + 原始属性 + 相邻关系归并为一条
        const items: IInlineMemoItem[] = [];
        const counters = new Map<string, number>();
        let current: IMemoGroup | undefined;
        this.protyle.wysiwyg.element.querySelectorAll('[data-type~="inline-memo"]').forEach((span) => {
            const block = hasClosestByAttribute(span, "data-node-id", null);
            if (!block) {
                current = undefined;
                return;
            }
            const blockID = block.getAttribute("data-node-id");
            const index = counters.get(blockID) || 0;
            counters.set(blockID, index + 1);
            const rawAttr = span.getAttribute("data-inline-memo-content") || "";
            if (current && current.blockID === blockID && current.rawAttr === rawAttr &&
                isAdjacentMemoSpan(current.lastSpan, span)) {
                current.indexes.push(index);
                current.anchor += span.textContent || "";
                current.lastSpan = span;
                return;
            }
            current = {
                blockID,
                indexes: [index],
                anchor: span.textContent || "",
                memo: decodeInlineMemoContent(rawAttr),
                rawAttr,
                lastSpan: span
            };
            items.push(current);
        });
        this.data = items;
        this.render();
    }

    private getFilteredItems(): IInlineMemoItem[] {
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const keywords = inputElement.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (keywords.length === 0) {
            return this.data;
        }
        return this.data.filter(item => {
            const text = `${item.memo || ""} ${item.anchor || ""}`.toLowerCase();
            return keywords.every(keyword => text.includes(keyword));
        });
    }

    private render() {
        const items = this.getFilteredItems();
        if (items.length === 0) {
            this.listElement.innerHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
            return;
        }
        this.listElement.innerHTML = items.map((item, position) => {
            const anchorText = item.anchor.length > ANCHOR_LIMIT ? item.anchor.slice(0, ANCHOR_LIMIT) + "..." : item.anchor;
            const contentClass = item.memo ? "memo-card__content" : "memo-card__content memo-card__content--empty";
            return `<div class="memo-card" data-node-id="${escapeAttr(item.blockID)}" data-position="${position}">
    <div class="memo-card__quote" title="${escapeAttr(item.anchor)}">${escapeHtml(anchorText)}</div>
    <div class="memo-card__row">
        <div class="${contentClass}" title="${escapeAttr(item.memo)}">${escapeHtml(item.memo) || window.siyuan.languages.memo}</div>
        <span class="block__icon memo-card__edit" data-type="edit"><svg><use xlink:href="#iconEdit"></use></svg></span>
    </div>
</div>`;
        }).join("");
    }

    private startEdit(cardElement: HTMLElement) {
        if (cardElement.querySelector("textarea")) {
            return;
        }
        const position = parseInt(cardElement.getAttribute("data-position") || "-1", 10);
        const current = Number.isInteger(position) ? this.getFilteredItems()[position] : undefined;
        if (!current) {
            return;
        }
        const contentElement = cardElement.querySelector(".memo-card__content") as HTMLElement;
        const textElement = document.createElement("textarea");
        textElement.className = "b3-text-field";
        textElement.rows = 1;
        textElement.value = current.memo;
        textElement.placeholder = window.siyuan.languages.memo;
        contentElement.replaceWith(textElement);
        const autoHeight = () => {
            textElement.style.height = "auto";
            textElement.style.height = textElement.scrollHeight + "px";
        };
        autoHeight();
        textElement.focus();
        textElement.setSelectionRange(textElement.value.length, textElement.value.length);
        let finished = false;
        const finish = (save: boolean) => {
            if (finished) {
                return;
            }
            finished = true;
            if (!save || textElement.value === current.memo) {
                this.render();
                return;
            }
            this.saveMemo(current, textElement.value);
        };
        textElement.addEventListener("input", autoHeight);
        textElement.addEventListener("keydown", (event) => {
            if (event.isComposing) {
                return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                finish(true);
            } else if (event.key === "Escape") {
                event.preventDefault();
                finish(false);
            }
        });
        textElement.addEventListener("blur", () => finish(true));
    }

    private saveMemo(item: IInlineMemoItem, value: string) {
        if (!this.protyle || !this.protyle.element.isConnected) {
            this.update();
            return;
        }
        const blockElement = this.protyle.wysiwyg.element.querySelector(`[data-node-id="${CSS.escape(item.blockID)}"]`);
        if (!blockElement) {
            this.update();
            return;
        }
        const spans = Array.from(blockElement.querySelectorAll('[data-type~="inline-memo"]'));
        const targets = item.indexes.map(index => spans[index]).filter(span => !!span);
        if (targets.length === 0) {
            this.update();
            return;
        }
        const oldHTML = blockElement.outerHTML;
        targets.forEach(span => {
            if (value) {
                span.setAttribute("data-inline-memo-content", encodeInlineMemoContent(value));
            } else {
                // 空值移除行级备注类型并保留划线文本，与编辑器工具栏的处理一致
                const types = (span.getAttribute("data-type") || "").split(" ")
                    .filter(type => type && type !== "inline-memo");
                if (types.length === 0) {
                    span.outerHTML = span.innerHTML;
                } else {
                    span.setAttribute("data-type", types.join(" "));
                    span.removeAttribute("data-inline-memo-content");
                }
            }
        });
        blockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(this.protyle, blockElement, oldHTML);
        this.update();
    }
}
