const debug = require('debug')('Bina:Contacts')
const http = require('http')
const router = require('express').Router()
const vCard = require('vcards-js')

const ldapService = require('../ldapService')
const formatters = require('../formatters')
const photosController = require('./photos')

const all = (req, res) => {
  debug('Getting all contacts in json format')
  ldapService((err, result) => {
    if (err) {
      res.status(500).json({ name: err.name, msg: err.message })
      return
    }
    res.json(result)
  })
}

const full = (req, res) => {
  debug('Getting all contacts (with photo) in json format')
  ldapService((err, result) => {
    if (err) {
      res.status(500).json({ name: err.name, msg: err.message })
      return
    }
    Promise.all(result.map(contact =>
      new Promise((resolve, reject) => {
        if (!contact.id) {
          resolve(contact)
          return
        }
        http.get(`${process.env.PHOTOS_URL}${contact.id}.jpg`, (response) => {
          const rawData = []
          response.on('data', (chunk) => { rawData.push(chunk) })
          response.on('error', (error) => {
            reject(error)
          })
          response.on('end', () => {
            const type = response.headers['content-type']
            const photo = {
              type: type.indexOf('image') >= 0 ? type : null,
              data: Buffer.concat(rawData).toString('base64'),
            }
            resolve({ ...contact, photo })
          })
        })
      })))
      .then((contacts) => {
        res.send(contacts)
      })
  })
}

router.get('/all.json', process.env.FULL_JSON === 'true' ? full : all)

router.get('/:brand.xml', (req, res) => {
  debug(`Request contacts in '${req.params.brand}' format`)
  ldapService((err, result) => {
    if (err) throw err
    const transform = formatters[req.params.brand]
    const xml = transform(result)
    res.set('Content-Type', 'text/xml')
    res.send(xml.toString())
  })
})

router.use('/:contact.jpg', photosController)

router.get('/:contact.vcf', (req, res) => {
  debug(`Getting vCard contact (${req.params.contact})`)
  ldapService((err, result) => {
    if (err) throw err
    const contact = result.filter(item => item.id === req.params.contact)[0]
    const card = vCard()
    card.firstName = contact.fullName.split(' ').shift()
    card.middleName = contact.fullName.split(' ').slice(1, -1).join(' ')
    card.lastName = contact.fullName.split(' ').pop()
    card.nickname = contact.id
    card.organization = contact.company
    card.title = contact.title
    card.role = contact.title
    card.note = contact.department
    if (contact.physicalDeliveryOfficeName) {
      card.note += ` - ${contact.physicalDeliveryOfficeName}`
    }
    if (contact.description) {
      card.note += `\n\n${contact.description}`
    }
    card.workPhone = contact.phones.telephoneNumber
    card.cellPhone = contact.phones.mobile
    card.homePhone = contact.phones.homePhone
    card.workPhone = contact.phones.ipPhone
    card.workFax = contact.facsimileTelephoneNumber
    card.email = contact.emails.mail
    card.source = `${req.protocol}://${req.get('Host')}${req.url}`
    card.logo.attachFromUrl(process.env.LOGO_URL, 'PNG')

    http.get(`${process.env.PHOTOS_URL}${contact.id}.jpg`, (response) => {
      const rawData = []
      response.on('data', (chunk) => { rawData.push(chunk) })
      response.on('end', () => {
        card.photo.url = Buffer.concat(rawData).toString('base64')
        card.photo.mediaType = 'JPG'
        card.photo.base64 = true
        res.set('Content-Type', 'text/vcard')
        res.set(
          'Content-Disposition',
          `inline; filename="${contact.fullName}.vcf"`
        )
        res.send(card.getFormattedString())
      })
    })
  })
})

module.exports = router
