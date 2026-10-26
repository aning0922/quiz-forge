import { expect, type Page } from "@playwright/test";

/** Inject private fixture passwords without putting them in locator failure logs. */
export async function enterStudioPassword(
  page: Page,
  loginName: string,
  password: string,
) {
  await expect(page.getByLabel("登录账号", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("密码", { exact: true })).toBeEnabled();
  try {
    await page.evaluate(
      ({ loginName, password }) => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        if (!setter) throw Error();
        for (const [name, value] of [
          ["username", loginName],
          ["password", password],
        ]) {
          const input = document.querySelector(`input[name="${name}"]`);
          if (!(input instanceof HTMLInputElement) || input.disabled)
            throw Error();
          setter.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      { loginName, password },
    );
  } catch {
    throw Error("STUDIO_PASSWORD_E2E_INPUT_UNAVAILABLE");
  }
}
export async function signInStudioPassword(
  page: Page,
  account: { identifier: string; secret: string },
) {
  await page.goto("/studio/login");
  await enterStudioPassword(page, `test-${account.identifier}`, account.secret);
  await page.getByRole("button", { name: "登录 Studio", exact: true }).click();
  await expect(page).not.toHaveURL(/\/studio\/login$/);
}
