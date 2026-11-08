import { withPoppyseed } from "poppyseed/next/config";
import { approvalHeaders } from "./lib/approval-headers";

export default withPoppyseed({ headers: async () => approvalHeaders });
