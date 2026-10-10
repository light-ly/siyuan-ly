/** 滚动到设置面板中的指定分组，用于从外部入口深链到具体分组 */
export const focusSettingGroup = (root: ParentNode, groupId: string) => {
    root.querySelector(`[data-config-group-id="${CSS.escape(groupId)}"]`)?.scrollIntoView({block: "start"});
};
