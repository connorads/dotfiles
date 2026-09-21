Install provider plugins through the project's package manager with pinned,
reviewed versions and existing install-script protections. The standalone plugin
downloader is a separate acquisition path; a version pin does not apply the
package manager's quarantine or integrity checks. Do not silently fall back to it.
