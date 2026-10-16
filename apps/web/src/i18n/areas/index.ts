// Every area's strings. Add a new area file here (see ../README.md).
import app from "./app";
import common from "./common";
import lobby from "./lobby";
import settings from "./settings";
import table from "./table";
import actions from "./actions";
import coach from "./coach";
import board from "./board";
import rules from "./rules";
import account from "./account";
import profile from "./profile";
import season from "./season";

export const AREAS = [common, settings, app, lobby, table, actions, coach, board, rules, account, profile, season] as const;
