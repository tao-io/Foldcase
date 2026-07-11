export const MANIFEST_URL = "/__openstory/manifest.json";
export const STORY_PATH_PREFIX = "/__story/";

export const STORAGE_KEY_THEME = "openstory:shell:theme";
export const STORAGE_KEY_NAV_COLLAPSED = "openstory:shell:nav-collapsed";

export const PARENT_MESSAGE_SOURCE = "openstory";
export const SHELL_MESSAGE_SOURCE = "openstory-shell";

export const KEYBOARD_RELOAD = "r";
export const KEYBOARD_TOGGLE_THEME = "t";
export const KEYBOARD_TOGGLE_NAV = "[";

export const MOBILE_BREAKPOINT_PX = 768;
export const CONTROLS_PANEL_HEIGHT_PX = 192;
export const CONTROLS_PANEL_MOBILE_HEIGHT_PX = 256;
export const SIDEBAR_WIDTH_PX = 288;

/** Cap the actions message log so a chatty story can't grow it unbounded. */
export const MESSAGE_LOG_LIMIT = 200;

/** Cap the interactions step ledger so a looping play can't grow it unbounded. */
export const STEP_LOG_LIMIT = 200;
