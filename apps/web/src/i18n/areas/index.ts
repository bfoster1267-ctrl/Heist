// Every area's strings. Add a new area file here (see ../README.md).
import app from "./app";
import common from "./common";
import lobby from "./lobby";
import settings from "./settings";
import table from "./table";
import actions from "./actions";

export const AREAS = [common, settings, app, lobby, table, actions] as const;
