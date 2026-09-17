import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readdirSync, statSync } from 'fs'
import { writeFile, mkdir, rm, copyFile } from 'fs/promises'
import { spawn } from 'child_process'
import * as path from 'path'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/tor-install
 *   Accepts a multipart form upload with a `file` field (the tor expert bundle
 *   .tar.gz). Extracts it into ./tor/ so the app can spawn tor.exe/tor from
 *   there. Returns { ok, binaryPath } on success.
 *
 * This lets users pick the tar.gz they downloaded and have the app set up Tor
 * without manual extraction.
 */
async function POST_impl(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'No file uploaded. Select the tor expert bundle .tar.gz file.' },
        { status: 400 },
      )
    }

    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.tar.gz') && !fileName.endsWith('.tgz')) {
      return NextResponse.json(
        { ok: false, error: 'File must be a .tar.gz archive (the tor expert bundle).' },
        { status: 400 },
      )
    }

    const cwd = process.cwd()
    const torDir = path.join(cwd, 'tor')

    // Clear any previous tor folder contents.
    if (existsSync(torDir)) {
      await rm(torDir, { recursive: true, force: true })
    }
    await mkdir(torDir, { recursive: true })

    // Save the uploaded file to a temp path.
    const tmpArchive = path.join(cwd, 'tor-bundle.tar.gz')
    const bytes = await file.arrayBuffer()
    await writeFile(tmpArchive, Buffer.from(bytes))

    // Extract using the system `tar` command (available on Windows 10+, macOS, Linux).
    await new Promise<void>((resolve, reject) => {
      const tar = spawn('tar', ['-xzf', tmpArchive, '-C', torDir], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      tar.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      tar.on('error', (err) =>
        reject(
          new Error(
            `tar command failed: ${err.message}. On Windows, ensure tar.exe is available (built into Windows 10+).`,
          ),
        ),
      )
      tar.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar extraction failed (exit ${code}): ${stderr}`))
      })
    })

    // Clean up the temp archive.
    await rm(tmpArchive, { force: true })

    // Verify the binary exists.
    const isWindows = process.platform === 'win32'
    const binaryName = isWindows ? 'tor.exe' : 'tor'
    const binaryPath = path.join(torDir, binaryName)

    // Recursively search for the binary if it's not at the tor/ root
    // (the tar.gz may extract into a subfolder).
    function searchForBinary(dir: string, depth: number): string | null {
      if (depth > 3) return null
      try {
        const entries = readdirSync(dir)
        for (const entry of entries) {
          const fullPath = path.join(dir, entry)
          if (entry === binaryName && existsSync(fullPath)) return fullPath
          try {
            if (statSync(fullPath).isDirectory()) {
              const found = searchForBinary(fullPath, depth + 1)
              if (found) return found
            }
          } catch {
            // stat failed, skip
          }
        }
      } catch {
        // ignore
      }
      return null
    }

    let foundPath: string | null = existsSync(binaryPath) ? binaryPath : searchForBinary(torDir, 0)

    if (!foundPath) {
      return NextResponse.json(
        {
          ok: false,
          error: `Extraction succeeded but ${binaryName} was not found inside the archive. Make sure you downloaded the tor expert bundle (not the tor browser).`,
        },
        { status: 422 },
      )
    }

    // If the binary is in a subfolder, copy it (and any .dll files on Windows)
    // to the tor/ root so tor.ts finds it easily.
    if (path.dirname(foundPath) !== torDir) {
      const destPath = path.join(torDir, binaryName)
      await copyFile(foundPath, destPath)

      if (isWindows) {
        const srcDir = path.dirname(foundPath)
        try {
          const entries = readdirSync(srcDir)
          for (const entry of entries) {
            if (entry.toLowerCase().endsWith('.dll')) {
              const srcDll = path.join(srcDir, entry)
              const destDll = path.join(torDir, entry)
              if (existsSync(srcDll)) {
                await copyFile(srcDll, destDll)
              }
            }
            // Also copy the geoip data files Tor needs.
            if (entry === 'geoip' || entry === 'geoip6') {
              const srcFile = path.join(srcDir, entry)
              const destFile = path.join(torDir, entry)
              if (existsSync(srcFile)) {
                await copyFile(srcFile, destFile)
              }
            }
          }
        } catch {
          // ignore copy errors for optional files
        }
      }

      foundPath = destPath
    }

    return NextResponse.json({
      ok: true,
      message: 'Tor installed successfully',
      binaryPath: foundPath,
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Installation failed' },
      { status: 500 },
    )
  }
}

export const POST = guard(POST_impl)
