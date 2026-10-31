import i18next from 'i18next'
import type { z } from 'zod'

type ZodErrorMap = Parameters<typeof z.setErrorMap>[0]

const ns = 'zod'

function joinValues(values: readonly unknown[], separator = ' | ') {
  return values
    .map(value => (typeof value === 'string' ? `'${value}'` : String(value)))
    .join(separator)
}

function stringifyValue(value: unknown) {
  return JSON.stringify(value, (_key, val) =>
    typeof val === 'bigint' ? val.toString() : val,
  )
}

type SizedOrigin = 'string' | 'number' | 'array' | 'date'

function isSizedOrigin(origin: string): origin is SizedOrigin {
  return (
    origin === 'string' ||
    origin === 'number' ||
    origin === 'array' ||
    origin === 'date'
  )
}

function tooSmallOrBig(
  code: 'too_small' | 'too_big',
  issue: {
    origin: string
    minimum?: number | bigint
    maximum?: number | bigint
    inclusive?: boolean
    exact?: boolean
  },
  path: { path?: string },
) {
  const origin = issue.origin === 'int' ? 'number' : issue.origin
  if (!isSizedOrigin(origin)) return undefined

  if (
    code === 'too_small' &&
    origin === 'string' &&
    issue.minimum === 1 &&
    issue.inclusive
  ) {
    return i18next.t('errors.too_small.string.inclusive_one', { ns, ...path })
  }

  const variant = issue.exact
    ? 'exact'
    : issue.inclusive
      ? 'inclusive'
      : 'not_inclusive'
  const bound = (code === 'too_small' ? issue.minimum : issue.maximum) as number
  const key = `errors.${code}.${origin}.${variant}`

  return i18next.t(key as never, {
    ns,
    minimum: bound,
    maximum: bound,
    ...path,
  })
}

export const zodErrorMap: ZodErrorMap = issue => {
  const path: { path?: string } = issue.path?.length
    ? { path: issue.path.join('.') }
    : {}

  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined) {
        return i18next.t('errors.invalid_type_received_undefined', {
          ns,
          ...path,
        })
      }
      if (issue.input === null) {
        return i18next.t('errors.invalid_type_received_null', { ns, ...path })
      }
      return i18next.t('errors.invalid_type', {
        ns,
        expected: i18next.t(`types.${issue.expected}`, {
          ns,
          defaultValue: issue.expected,
        }),
        ...path,
      })
    }
    case 'invalid_value': {
      if (issue.values.length === 1) {
        return i18next.t('errors.invalid_literal', {
          ns,
          expected: stringifyValue(issue.values[0]),
          ...path,
        })
      }
      return i18next.t('errors.invalid_enum_value', {
        ns,
        options: joinValues(issue.values),
        ...path,
      })
    }
    case 'unrecognized_keys':
      return i18next.t('errors.unrecognized_keys', {
        ns,
        keys: joinValues(issue.keys, ', '),
        count: issue.keys.length,
        ...path,
      })
    case 'invalid_union':
    case 'invalid_key':
    case 'invalid_element':
      return i18next.t('errors.invalid_union', { ns, ...path })
    case 'not_multiple_of':
      return i18next.t('errors.not_multiple_of', {
        ns,
        multipleOf: issue.divisor,
        ...path,
      })
    case 'invalid_format': {
      switch (issue.format) {
        case 'email':
          return i18next.t('errors.invalid_string.email', { ns, ...path })
        case 'url':
          return i18next.t('errors.invalid_string.url', { ns, ...path })
        case 'uuid':
          return i18next.t('errors.invalid_string.uuid', { ns, ...path })
        case 'cuid':
          return i18next.t('errors.invalid_string.cuid', { ns, ...path })
        case 'datetime':
          return i18next.t('errors.invalid_string.datetime', { ns, ...path })
        case 'regex':
          return i18next.t('errors.invalid_string.regex', { ns, ...path })
        case 'starts_with':
          return i18next.t('errors.invalid_string.startsWith', {
            ns,
            startsWith: issue.prefix as string,
            ...path,
          })
        case 'ends_with':
          return i18next.t('errors.invalid_string.endsWith', {
            ns,
            endsWith: issue.suffix as string,
            ...path,
          })
        default:
          return undefined
      }
    }
    case 'too_small':
      return tooSmallOrBig('too_small', issue, path)
    case 'too_big':
      return tooSmallOrBig('too_big', issue, path)
    case 'custom':
      return issue.message || i18next.t('errors.custom', { ns, ...path })
    default:
      return undefined
  }
}
