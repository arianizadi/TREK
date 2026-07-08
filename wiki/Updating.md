# Updating

How to update TREK to a newer version without losing data.

## Before You Update

Back up your data first. Go to Admin Panel → Backups and create a manual backup, or copy your `./data` and `./uploads` directories to a safe location. See [Backups](Backups) for details.

## Docker Compose (Custom Fork)

Update from the git upstream and rebuild your local image:

```bash
cd /home/outkast/trek
./update-from-upstream.sh
```

The updater backs up `data` and `uploads`, runs `git pull --rebase upstream main`, builds `trek:local`, starts the container, and verifies health plus the database schema version.

If you already pulled or merged source changes manually, rebuild and restart with:

```bash
cd /home/outkast/trek
docker compose up -d --build app
```

Your data is untouched because only `./data` and `./uploads` are mounted into the container.

## Docker Run

This install is intended to run through Compose so it always builds the custom fork. If you temporarily started TREK with `docker run`, replace it with the compose deployment:

```bash
cd /home/outkast/trek
docker rm -f trek
docker compose up -d --build app
```

> **Tip:** Not sure which volume paths you used? Check before removing:
> ```bash
> docker inspect trek --format '{{json .Mounts}}'
> ```

## Database Migrations

TREK runs any pending database migrations automatically at startup. No manual migration steps are required after pulling a new image.

## Encryption Key Note

If you are upgrading from a version that predates the dedicated `ENCRYPTION_KEY` (i.e. you have no `ENCRYPTION_KEY` environment variable set), TREK automatically falls back to `./data/.jwt_secret` on startup and immediately promotes it to `./data/.encryption_key`. No manual steps are required — the transition is handled at first boot after the upgrade.

If you want to rotate to a new key at any point (not required for a normal update), see [Encryption-Key-Rotation](Encryption-Key-Rotation) for the full procedure.

## Proxmox VE (LXC)

If you installed TREK via the [Proxmox VE Community Scripts](https://community-scripts.org/scripts/trek), run the following command inside the **LXC container** and select **Update** when prompted:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/trek.sh)"
```

> **Tip:** Always check the [community-scripts TREK page](https://community-scripts.org/scripts/trek) to confirm the latest command before running.

The script stops the service, backs up your data and uploads, applies the new release, restores the backup, and restarts. No manual steps required.

To verify the update completed and check for errors:

```bash
# Inside the container (pct enter <id> from the Proxmox shell)
journalctl -u trek -n 50
```

## Portainer

Open the **Stacks** list, click the TREK stack, then click **Redeploy**.

**`latest` or major-version tag** — enable the **Re-pull image and redeploy** switch before confirming. Portainer pulls the newest matching image and recreates the container.

![Re-pull image and redeploy switch ticked, with arrows pointing to the switch and the Update button](assets/portainer-force-pull.png)

**Pinned full-version tag** (e.g. `3.0.15`) — edit the stack, update the tag in the `image:` line, then click **Update the stack**. No re-pull switch needed; the tag change forces a fresh pull.

![Edit stack page with an arrow pointing to the image tag in the compose editor](assets/portainer-update-version.png)

![Edit stack page with an arrow pointing to the Update the stack button](assets/portainer-update-stack.png)

See [Install-Portainer](Install-Portainer) for the full installation walkthrough.

## Unraid

In the Unraid Docker tab, click the TREK container and select **Update**. Unraid will pull the latest image and restart with the same volumes.

## Next Steps

- [Backups](Backups) — schedule automatic backups so you always have a restore point before updates
- [Encryption-Key-Rotation](Encryption-Key-Rotation) — if you need to rotate or migrate the encryption key
- [Install-Docker-Compose](Install-Docker-Compose) — switch to Compose for easier future updates
