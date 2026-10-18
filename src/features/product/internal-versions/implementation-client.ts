import { rendererIdentitySchema } from "./identity-contracts";
import {
  findRendererImplementationDescriptor,
  rendererImplementationAvailable,
} from "./implementation-catalog";
import { bindRendererClientV1 } from "./implementations/renderer-client-v1";
import type { DisplayFontDescriptorV1 } from "@/lib/assessment-contract/display-v1";
/** Only an exact compiled entry can supply the font and component implementation; never default/current. */
export function resolveRendererClient(input: unknown) {
  const parsed = rendererIdentitySchema.safeParse(input);
  if (!parsed.success || !rendererImplementationAvailable(parsed.data))
    return null;
  const entry = findRendererImplementationDescriptor(parsed.data);
  if (!entry) return null;
  const selected = entry.descriptor.font;
  const font: DisplayFontDescriptorV1 = {
    ...selected,
    file: selected.file as DisplayFontDescriptorV1["file"],
    coverage: selected.coverage as DisplayFontDescriptorV1["coverage"],
    licenseFile: selected.licenseFile as DisplayFontDescriptorV1["licenseFile"],
  };
  const renderer = bindRendererClientV1(font);
  if (
    Object.values(entry.descriptor.components).some(
      (c) => !(c.id in renderer.components),
    )
  )
    return null;
  return Object.freeze({
    identity: parsed.data,
    descriptor: entry.descriptor,
    ...renderer,
  });
}
