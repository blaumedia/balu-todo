import { useEffect, useState } from "react";
import type { Channel, ChannelType } from "@balu/domain";
import { ApiError } from "@balu/api-client";
import { api } from "../lib/clients.js";
import { useT } from "../lib/useT.js";
import { useApp } from "../store/app.js";
import type { TranslationKey } from "../i18n/index.js";
import { Button } from "../components/Button.js";
import { Icon } from "../components/Icon.js";

const TYPE_KEY: Record<ChannelType, TranslationKey> = {
  ntfy: "channels.type.ntfy",
  email: "channels.type.email",
  telegram: "channels.type.telegram",
};
const TYPE_ICON: Record<ChannelType, string> = { ntfy: "bell", email: "mail", telegram: "send" };
const TYPES: ChannelType[] = ["ntfy", "email", "telegram"];

const controlStyle: React.CSSProperties = {
  height: 36,
  padding: "0 10px",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  fontSize: "var(--text-secondary-size)",
  fontFamily: "var(--font-sans)",
  outline: "none",
};

function emptyChannel(type: ChannelType, ownEmail: string): Channel {
  if (type === "ntfy") return { type: "ntfy", url: "" };
  // The server only accepts the account's own address (no confirmation flow).
  if (type === "email") return { type: "email", address: ownEmail };
  return { type: "telegram", chat_id: "" };
}

function channelValue(c: Channel): string {
  return c.type === "ntfy" ? c.url : c.type === "email" ? c.address : c.chat_id;
}
function withValue(c: Channel, v: string): Channel {
  if (c.type === "ntfy") return { type: "ntfy", url: v };
  if (c.type === "email") return { type: "email", address: v };
  return { type: "telegram", chat_id: v };
}
function placeholderKey(type: ChannelType): TranslationKey {
  return type === "ntfy" ? "channels.ntfyUrl" : type === "email" ? "channels.emailAddress" : "channels.telegramChatId";
}

export function ChannelsSection() {
  const { t } = useT();
  const showToast = useApp((s) => s.showToast);
  const ownEmail = useApp((s) => s.user?.email ?? "");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [addType, setAddType] = useState<ChannelType>("ntfy");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void api
      .getChannels()
      .then(setChannels)
      .catch(() => {
        /* backend may not be live yet */
      });
  }, []);

  function update(i: number, v: string) {
    setChannels((cs) => cs.map((c, idx) => (idx === i ? withValue(c, v) : c)));
    setDirty(true);
  }
  function remove(i: number) {
    setChannels((cs) => cs.filter((_, idx) => idx !== i));
    setDirty(true);
  }
  function add() {
    setChannels((cs) => [...cs, emptyChannel(addType, ownEmail)]);
    setDirty(true);
  }

  async function save() {
    try {
      const saved = await api.putChannels(channels.filter((c) => channelValue(c).trim() !== ""));
      setChannels(saved);
      setDirty(false);
      showToast(t("channels.saved"));
    } catch (e) {
      if (e instanceof ApiError && e.code === "channel_unavailable") {
        showToast(t("channels.unavailable").replace("{type}", t(TYPE_KEY[addType])));
      } else {
        showToast(t("auth.errorGeneric"));
      }
    }
  }

  async function test(type: ChannelType) {
    try {
      await api.testChannel(type);
      showToast(t("channels.tested"));
    } catch (e) {
      if (e instanceof ApiError && e.code === "channel_unavailable") {
        showToast(t("channels.unavailable").replace("{type}", t(TYPE_KEY[type])));
      } else {
        showToast(t("auth.errorGeneric"));
      }
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-tertiary)" }}>{t("channels.subtitle")}</div>

      {channels.length === 0 && (
        <div style={{ fontSize: "var(--text-secondary-size)", color: "var(--text-tertiary)" }}>{t("channels.none")}</div>
      )}

      {channels.map((c, i) => (
        <div key={`${c.type}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name={TYPE_ICON[c.type]} size={16} color="var(--text-secondary)" />
          <span style={{ width: 64, fontSize: 12, color: "var(--text-secondary)" }}>{t(TYPE_KEY[c.type])}</span>
          <input
            style={{ ...controlStyle, flex: 1, minWidth: 0 }}
            placeholder={t(placeholderKey(c.type))}
            value={channelValue(c)}
            onChange={(e) => update(i, e.target.value)}
          />
          <button
            type="button"
            onClick={() => void test(c.type)}
            aria-label={t("channels.test")}
            title={t("channels.test")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 4 }}
          >
            <Icon name="send" size={16} />
          </button>
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={t("channels.remove")}
            title={t("channels.remove")}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", padding: 4 }}
          >
            <Icon name="trash-2" size={16} />
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select style={controlStyle} value={addType} onChange={(e) => setAddType(e.target.value as ChannelType)}>
          {TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(TYPE_KEY[ty])}
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" icon="plus" onClick={add}>
          {t("channels.add")}
        </Button>
        {dirty && (
          <Button size="sm" icon="check" onClick={() => void save()}>
            {t("channels.save")}
          </Button>
        )}
      </div>
    </div>
  );
}
