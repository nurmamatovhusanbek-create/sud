import { describe, expect, test } from 'bun:test'
import { classifyGitFailure } from '../git-failure'

describe('classifyGitFailure', () => {
  test('dubious ownership: uses the exact command git printed', () => {
    const r = classifyGitFailure({ stderr: "fatal: detected dubious ownership in repository at 'C:/Users/User/Desktop/sud'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory C:/Users/User/Desktop/sud\n" })
    expect(r.kind).toBe('dubious_ownership')
    expect(r.detail).toContain('git config --global --add safe.directory C:/Users/User/Desktop/sud')
  })
  test('dubious ownership without the hint: builds it from the folder, with forward slashes', () => {
    const r = classifyGitFailure({ stderr: 'fatal: detected dubious ownership' }, 'C:\\Users\\User\\Desktop\\sud')
    expect(r.detail).toContain('safe.directory "C:/Users/User/Desktop/sud"')
  })
  test('a timeout is not «git missing»', () => {
    expect(classifyGitFailure({ code: 'ETIMEDOUT' }).kind).toBe('timeout')
    expect(classifyGitFailure({ killed: true, signal: 'SIGTERM' }).kind).toBe('timeout')
  })
  test('git missing from PATH, on Windows and on Unix', () => {
    expect(classifyGitFailure({ code: 'ENOENT' }).kind).toBe('missing')
    expect(classifyGitFailure({ stderr: "'git' is not recognized as an internal or external command" }).kind).toBe('missing')
    expect(classifyGitFailure({ stderr: '/bin/sh: git: command not found' }).kind).toBe('missing')
  })
  test('the remote cannot be reached: the field message, DNS, reset', () => {
    const field = "fatal: unable to access 'https://github.com/nurmamatovhusanbek-create/sud.git/': Failed to connect to github.com port 443 after 21112 ms: Could not connect to server"
    expect(classifyGitFailure({ stderr: field, code: 128 }).kind).toBe('network')
    expect(classifyGitFailure({ stderr: 'fatal: unable to access: Could not resolve host: github.com' }).kind).toBe('network')
    expect(classifyGitFailure({ message: 'Connection reset by peer' }).kind).toBe('network')
    expect(classifyGitFailure({ killed: true, signal: 'SIGTERM' }).kind).toBe('timeout') // our own kill is still «slow», not «unreachable»
  })
  test('not a repository', () => {
    expect(classifyGitFailure({ stderr: 'fatal: not a git repository (or any of the parent directories): .git' }).kind).toBe('not_repo')
  })
  test('anything else keeps git\'s own first line, bounded', () => {
    const r = classifyGitFailure({ stderr: 'fatal: something odd\nmore' })
    expect(r).toEqual({ kind: 'other', detail: 'Git xato berdi: fatal: something odd' })
    expect(classifyGitFailure(undefined).kind).toBe('other')
  })
  test('every message is native Uzbek: no straight apostrophes in words, no em dash', () => {
    const all = [classifyGitFailure({ code: 'ENOENT' }), classifyGitFailure({ code: 'ETIMEDOUT' }), classifyGitFailure({ stderr: 'not a git repository' }), classifyGitFailure({ stderr: 'dubious ownership' }, 'x'), classifyGitFailure({ stderr: 'Could not resolve host' })]
    for (const m of all) expect(m.detail).not.toMatch(/[a-z]'[a-z]|—/i)
  })
})
