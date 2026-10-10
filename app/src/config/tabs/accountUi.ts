import {processSync} from "../../dialog/processSystem";
import {refreshSyncCloudSpaceGroup, syncTabElement} from "./syncRuntime";
import {setCloudUser, type TCloudUser} from "./cloudUser";

/** WS 推送用户状态变更时应用登录态：同步内存状态、刷新同步面板并触发同步流程 */
export const applyCloudUserState = (user: TCloudUser | null, userName = "", accountSettingsRoot?: Element) => {
    setCloudUser(user, userName);
    const root = accountSettingsRoot || syncTabElement;
    if (root) {
        refreshSyncCloudSpaceGroup(root);
    }
    processSync();
};
