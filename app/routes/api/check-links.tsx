import type { ActionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import axios from 'axios'
import { notion } from '~/services/notion.server'
import { getErrorMessage } from '~/utils/errors'

export const loader = async () => {
  return json({ status: 405, message: 'Method Not Allowed' })
}

export const action = async ({ request }: ActionArgs) => {
  if (request.method === 'POST') {
    try {
      const authorization = request.headers.get('Authorization')

      if (authorization === `Bearer ${process.env.CRON_SECRET_KEY}`) {
        const { results } = await notion.databases.query({
          database_id: process.env.NOTION_DATABASE_ID ?? '',
        })

        if (!results.length) {
          return json({ status: 404, message: 'No links found' })
        }

        const checkForBrokenLink = async (page: any) => {
          const { id, properties } = page
          const { URL, Broken } = properties
          const gracePeriod = 1000 * 60 * 60 * 24 * 14

          const setBroken = async (broken: boolean) => {
            // If not broken, remove broken date
            if (!broken) {
              await notion.pages.update({
                page_id: id,
                properties: {
                  Broken: { date: null },
                },
              })

              return
            }

            // If been broken for more than 2 weeks, delete
            if (Date.parse(Broken.date?.start) + gracePeriod < Date.now()) {
              await notion.pages.update({
                page_id: id,
                archived: true,
              })

              return
            }

            if (!Broken.date) {
              await notion.pages.update({
                page_id: id,
                properties: {
                  Broken: { date: { start: new Date().toISOString() } },
                },
              })
            }
          }

          await axios(URL?.url)
            .then(async ({ status, data }) => {
              await setBroken(status >= 400 || !data.search(/chipmunk/i))
            })
            .catch(async () => {
              await setBroken(true)
            })
        }

        await Promise.all([results.map(checkForBrokenLink)])

        return json({ status: 200, success: true })
      } else {
        return json({ status: 401, message: 'Access forbidden' })
      }
    } catch (error) {
      return json({ status: 500, message: getErrorMessage(error) })
    }
  }

  return json({ status: 405, message: 'Method Not Allowed' })
}
