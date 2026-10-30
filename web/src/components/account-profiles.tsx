import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
type Profiles = { profiles: string[]; active: string | null };
export function AccountProfiles() {
  const [provider, setProvider] = useState("openai");
  const [name, setName] = useState("default");
  const [key, setKey] = useState("");
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setProfiles(null);
    setError("");
    void api<Profiles>(`/settings/accounts?provider=${provider}`)
      .then((p) => {
        if (active) setProfiles(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [provider]);
  async function act(action: string, profile: string) {
    setBusy(true);
    setError("");
    try {
      const next = await api<Profiles>("/settings/accounts", {
        provider,
        action,
        profile,
        ...(action === "set" ? { key } : {}),
      });
      setProfiles(next);
      if (action === "set") setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-card">
      <h2>Profils de clés API</h2>
      <p>
        Les clés sont enregistrées dans le trousseau système et ne sont jamais
        affichées après sauvegarde.
      </p>
      <Select
        value={provider}
        onValueChange={(value) => {
          setProvider(value);
          setKey("");
        }}
      >
        <SelectTrigger aria-label="Fournisseur de clé API">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {["openai", "openrouter", "anthropic", "google"].map((id) => (
              <SelectItem key={id} value={id}>
                {id}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      {profiles?.profiles.map((profile) => (
        <div className="settings-row" key={profile}>
          <div>
            <strong>{profile}</strong>
            <small>
              {profiles.active === profile ? "Profil actif" : "Disponible"}
            </small>
          </div>
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || profiles.active === profile}
              onClick={() => void act("use", profile)}
            >
              Utiliser
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Supprimer le profil ${profile} ?`))
                  void act("remove", profile);
              }}
            >
              Supprimer
            </Button>
          </div>
        </div>
      ))}
      <div className="account-inputs">
        <Input
          aria-label="Nom du profil"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="default"
        />
        <Input
          aria-label="Clé API"
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Clé API"
        />
        <Button
          disabled={busy || !key || !name}
          onClick={() => void act("set", name)}
        >
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
