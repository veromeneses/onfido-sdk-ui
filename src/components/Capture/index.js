import { h, Component } from 'preact'
import { events } from 'onfido-sdk-core'
import classNames from 'classnames'
import randomId from '../utils/randomString'
import { Uploader } from '../Uploader'
import Camera from '../Camera'
import Confirm from '../Confirm'
import { FaceTitle } from '../Face'
import { DocumentTitle } from '../Document'
import isDesktop from '../utils/isDesktop'
import DetectRTC from 'detectrtc'
import style from './style.css'
import { functionalSwitch, impurify } from '../utils'
import { canvasToBase64Images } from '../utils/canvas.js'
import { fileToBase64, isOfFileType, fileToLossyBase64Image } from '../utils/file.js'

export const FrontDocumentCapture = options => {
  return <Capture autoCapture={true} {...options} />
}

FrontDocumentCapture.defaultProps = {
  useWebcam: false,
  method: 'document',
  side: 'front'
}

export const BackDocumentCapture = options =>
  <Capture autoCapture={true} {...options} />

BackDocumentCapture.defaultProps = {
  useWebcam: false,
  method: 'document',
  side: 'back'
}

export const FaceCapture = options =>
  <Capture autoCapture={false} {...options} />

FaceCapture.defaultProps = {
  useWebcam: true,
  method: 'face'
}

class Capture extends Component {
  constructor (props) {
    super(props)
    this.state = {
      hasWebcamPermission: false,
      hasWebcam: DetectRTC.hasWebcam,
      DetectRTCLoading: true,
      uploadFallback: false
    }
    this.setCurrentCapture(props)
  }

  componentDidMount () {
    events.on('onMessage', (message) => this.handleMessages(message))
    this.checkWebcamSupport()
  }

  componentWillUnmount () {
    this.setState({uploadFallback: false})
  }

  componentWillReceiveProps(nextProps) {
    const {validCapture, method, side, hasUnprocessedCaptures} = nextProps
    if (method !== this.props.method || side !== this.props.side) {
      this.setCurrentCapture(nextProps)
    }
    if (validCapture) {
      this.setState({uploadFallback: false})
    }
    if (hasUnprocessedCaptures[method]){
      this.setState({fileError: false})
    }
  }

  setCurrentCapture ({actions, method, side}) {
    side = side ? side : null
    actions.setCurrentCapture({method, side})
  }

  checkWebcamSupport () {
    DetectRTC.load( _ => {
      this.setState({
        DetectRTCLoading: false,
        hasWebcam: DetectRTC.hasWebcam
      })
    })
  }

  supportsWebcam (){
    const supportNotYetUnknown = DetectRTC.isGetUserMediaSupported && this.state.DetectRTCLoading;
    return supportNotYetUnknown || this.state.hasWebcam;
  }

  //Fired when there is an active webcam feed
  onUserMedia = () => {
    this.setState({
      hasWebcam: true,
      hasWebcamPermission: true,
      DetectRTCLoading: false
    })
  }

  validateCapture = (id, valid) => {
    const { actions, method } = this.props
    actions.validateCapture({ id, valid, method})
  }

  maxAutomaticCaptures = 3

  createCapture(payload) {
    const { actions, method, side } = this.props
    payload.side = side
    actions.createCapture({method, capture: payload, maxCaptures: this.maxAutomaticCaptures})
  }

  handleMessages = (message) => {
    const { actions } = this.props
    const valid = message.valid;
    this.validateCapture(message.id, valid)
  }

  handleImage = (base64ImageLossy, base64capture, file) => {
    if (!base64capture) {
      console.warn('Cannot handle a null image')
      return;
    }
    const payload = this.createPayload(base64capture, base64ImageLossy, file)
    functionalSwitch(this.props.method, {
      document: ()=> this.handleDocument(payload),
      face: ()=> this.handleFace(payload)
    })
  }

  createPayload = (image, imageLossy, file) => ({
    id: randomId(),
    messageType: this.method,
    image, imageLossy, file
  })

  createSocketPayload = ({id, messageType, imageLossy, image, documentType}) =>
    JSON.stringify({id, messageType, image: imageLossy ? imageLossy : image, documentType})

  handleDocument(payload) {
    const { socket, method, documentType, unprocessedCaptures } = this.props
    const unprocessedDocuments = unprocessedCaptures[method]
    if (unprocessedDocuments.length === this.maxAutomaticCaptures){
      console.warn('Server response is slow, waiting for responses before uploading more')
      return
    }
    payload = {...payload, documentType}
    if (this.props.side === 'back') {
      payload = {...payload, valid: true}
    }
    else {
      socket.sendMessage(this.createSocketPayload(payload))
    }
    this.createCapture(payload)
  }

  handleFace(payload) {
    this.createCapture({...payload, valid: true})
  }

  onUploadFallback = file => {
    this.setState({uploadFallback: true})
    this.deleteCaptures()
    this.onImageFileSelected(file)
  }

  onScreenshot = canvas => {
    canvasToBase64Images(canvas, this.handleImage)
  }

  onImageFileSelected = file => {
    if (!isOfFileType(['jpg','jpeg','png','pdf'], file)){
      this.onFileTypeError()
      return
    }

    const onFilebase64 = fileBase64 => {
      const handleImageBound = lossyBase64 => this.handleImage(lossyBase64, fileBase64, file)
      if (isOfFileType(['jpg','jpeg','png'], file)){
        //avoid rendering pdfs or other formats to image,
        //due to inconsistencies between different browsers and the back end
        fileToLossyBase64Image(undefined, file,
          lossyBase64 => handleImageBound(lossyBase64),
          error => handleImageBound(undefined)
        )
      }
      else {
        handleImageBound(undefined)
      }
    }

    fileToBase64(file, onFilebase64, this.onFileGeneralError)
  }

  onFileTypeError = () => {
    this.setState({fileError: 'INVALID_TYPE'})
  }

  onFileGeneralError = () => {
    this.setState({fileError: 'INVALID_CAPTURE'})
  }

  deleteCaptures = () => {
    const {method, actions: {deleteCaptures}} = this.props
    deleteCaptures({method})
  }

  errorType = ({method, side, allInvalid}) => {
    const {fileError} = this.state
    if (fileError === 'INVALID_TYPE')     return fileError
    if (fileError === 'INVALID_CAPTURE')  return fileError
    if (allInvalid) return "INVALID_CAPTURE"
    return null;
  }

  render ({method, side, validCapture, allInvalid, useWebcam, hasUnprocessedCaptures, ...other}) {
    const useCapture = (!this.state.uploadFallback && useWebcam && this.supportsWebcam() && isDesktop)
    const hasCaptured = validCapture
    return (
      <CaptureScreen {...{method, side, useCapture, hasCaptured,
        onUserMedia: this.onUserMedia,
        onScreenshot: this.onScreenshot,
        onUploadFallback: this.onUploadFallback,
        onImageSelected: this.onImageFileSelected,
        uploading:hasUnprocessedCaptures[method],
        error: this.errorType({method, side, allInvalid}),
        ...other}}/>
    )
  }
}

const Title = ({method, side, useCapture}) => functionalSwitch(method, {
    document: () => <DocumentTitle useCapture={useCapture} side={side} />,
    face: ()=> <FaceTitle useCapture={useCapture} />
})

//TODO move to react instead of preact, since preact has issues handling pure components
//IF this component is pure some components, like Camera,
//will not have the componentWillUnmount method called
const CaptureMode = impurify(({method, side, useCapture, ...other}) => (
  <div>
    <Title {...{method, side, useCapture}}/>
    {useCapture ?
      <Camera {...{method, ...other}}/> :
      <Uploader {...{method,...other}}/>
    }
  </div>
))

const CaptureScreen = ({method, side, useCapture, hasCaptured, ...other})=> (
  <div className={classNames({
    [style.camera]: useCapture && !hasCaptured,
    [style.uploader]: !useCapture && !hasCaptured
  })}>
    {hasCaptured ?
      <Confirm {...{ method, ...other}} /> :
      <CaptureMode {...{method, side, useCapture, ...other}} />
    }
  </div>
)
