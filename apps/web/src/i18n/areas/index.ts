// Every area's strings. Add a new area file here (see ../README.md).
import app from "./app";
import common from "./common";
import lobby from "./lobby";
import settings from "./settings";

export const AREAS = [common, settings, app, lobby] as const;
