import { useAuth } from "../auth";

/** Page d'accueil vide : la nouvelle interface sera construite à partir d'ici, étape par étape. */
export default function Home() {
  const { user, logout } = useAuth();
  return (
    <section className="card">
      <h1>MyWorkshop</h1>
      <p className="muted">Nouvelle interface en préparation. Rien n'est affiché pour l'instant.</p>
      <p className="muted small">
        Connecté : {user.username} ({user.role}) ·{" "}
        <button type="button" className="linklike" onClick={logout}>
          Se déconnecter
        </button>
      </p>
    </section>
  );
}
