/** Mother-art and existing CSS geometry review only. No report, score, resource
 * approval or registered renderer identity is constructed by this component. */
/* eslint-disable @next/next/no-img-element -- Local raw mother-byte preview without a Next image optimizer. */
import type { CSSProperties } from "react";
import { qianzaiKnownCatalogRole } from "@/features/report/qianzai-tongxin/known-ten-selection";
import scenes from "@/features/theme/qianzai-tongxin/scenes.module.css";

export function QianzaiKnownArtPreview({
  roleRef,
  imageUrl,
  safeAreas = false,
}: {
  roleRef: { productId: string; id: string; version: string };
  imageUrl: string;
  safeAreas?: boolean;
}) {
  const role = qianzaiKnownCatalogRole(roleRef);
  if (!role) return <p>人物版本不匹配。</p>;
  return (
    <section className="known-art-preview" data-known-art-role={role.id}>
      <div className={scenes.fullRevealBackdrop}>
        <img src={imageUrl} alt={`${role.displayName}首样母图`} />
      </div>
      {safeAreas && (
        <>
          <div className={scenes.dynamicShade} />
          <div className={scenes.dynamicHeader}>
            <p>千载同心</p>
            <span>月下相逢</span>
          </div>
          <div
            className={scenes.dynamicIdentity}
            style={{ "--seal-characters": 2 } as CSSProperties}
          >
            <div className={scenes.dynamicNameRow}>
              <div className={scenes.dynamicNameGroup}>
                <p className={scenes.dynamicKicker}>你是</p>
                <div
                  className={`${scenes.dynamicNameArt} known-safe-box`}
                  data-known-name-box
                  aria-label="5:7姓名安全区"
                />
              </div>
              <span
                className={`${scenes.dynamicSeal} known-safe-box`}
                data-known-seal-box
                aria-label="称号红章安全区"
              />
              <blockquote
                className={`${scenes.dynamicQuote} known-safe-box`}
                data-known-quote-box
                aria-label="原单列竖句安全区"
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
