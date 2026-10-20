import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ConsumerAccessV1_1 } from "@/features/theme/consumer-v1-1/access";
export const render = () => renderToString(createElement(ConsumerAccessV1_1));
