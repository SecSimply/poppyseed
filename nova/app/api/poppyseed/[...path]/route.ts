import { toNextHandlers } from "poppyseed/next";
import { poppyseed } from "../../../../poppyseed.config";

export const { GET, POST, DELETE } = toNextHandlers(poppyseed);
