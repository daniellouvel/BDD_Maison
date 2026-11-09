"""Fournisseurs d'IA, isolés derrière des interfaces (voir base.py).

Règle : seuls les services (app/services/ai.py) importent ce paquet, et uniquement via
registry.py ; aucune logique métier ne dépend d'un fournisseur précis.
"""
