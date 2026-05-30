# CLA rollout — maintainer notes

Internal checklist for putting the Contributor License Agreement in place.
Not part of the product; safe to keep or delete once done.

## 1. Create the pinned signing issue

Create a GitHub issue titled **"Contributor License Agreement"**, pin it, and
use this body:

---

**Fleex now has a Contributor License Agreement.**

If you have contributed to Fleex (or plan to), please read
[CLA.md](../CLA.md) and accept it by replying to this issue with:

> I have read the Fleex Contributor License Agreement (CLA.md, version 1.0) and
> I agree to it for all of my past and future contributions to the Fleex
> project. — @your-github-username

Signing once covers all your past and future contributions. Thanks! 🙏

---

## 2. Message to send to existing contributors (FR)

Send this to **@jeremyhalin** (PRs #66, #69, #76, #77) and **Pablo Godinez**:

---

Salut 👋

Petite formalité de gestion sur Fleex : j'ai mis une licence (Elastic License
2.0) et un CLA — c'est standard sur les projets open source, ça permet de
garder les choses propres si jamais le projet évolue (relicence, version
commerciale, etc.).

Ça ne change rien pour toi : tu gardes ton code et tu peux le réutiliser où tu
veux. Ça dit juste que ta contribution au projet ne te crée pas d'obligation ni
de droit particulier dessus.

Pour valider, il suffit de lire le CLA.md et de commenter cette issue : <lien>
avec :

« I have read the Fleex Contributor License Agreement (CLA.md, version 1.0) and
I agree to it for all of my past and future contributions to the Fleex project.
— @ton-pseudo-github »

Merci ! 🙏

---

## 3. Record signatures

When each person comments, fill in their row in the Signatures table at the
bottom of [CLA.md](../CLA.md) (username + date).

## 4. (Optional, later) Automate

If the number of contributors grows, add a CLA-assistant GitHub Action that
blocks unsigned pull requests automatically. Not needed for a handful of known
contributors.
