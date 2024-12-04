import { Injectable } from "@nestjs/common";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "fs";
import * as path from 'path'
import Docker =  require('dockerode');



@Injectable()
export class DockerDownloadService {

  private imageName = "image.tar"
  private projectDir = __dirname + "../../../../temp_docker_images/"
  private docker = new Docker()

  private getRandomDirName() {
    return "img_" + Math.random().toString(36).substr(2, 9);
  }
  
  async downloadDockerImage(dockerImage: string) {
    const dirPath = path.join(this.projectDir, this.getRandomDirName())
    mkdirSync(dirPath, {recursive: true});

    const imagePath = path.join(dirPath, this.imageName)

    const onFinish = async () => {
      return await new Promise<void>((resolve, reject) => {
        this.docker.getImage(dockerImage).get().then(res => {
          const destination = createWriteStream(imagePath)

          res.pipe(destination).on('finish', ()=> {
            this.docker.getImage(dockerImage).remove()
            resolve()
          })
         
        }).catch(err => {
          reject(err);
        });
      });
    }
    

    await new Promise<void>((resolve, reject) => {
      this.docker.pull(dockerImage, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        
        this.docker.modem.followProgress(stream, async ()=> {
          await onFinish()
          resolve()
        });
      })

    });

    return imagePath
  }

  // async downloadDockerImage(dockerImage: string) {
  //   const dirPath = path.join(this.projectDir, this.getRandomDirName())
  //   mkdirSync(dirPath, {recursive: true});

  //   const imagePath = path.join(dirPath, this.imageName)

  //   const cmd = `docker save ${dockerImage} -o \"${imagePath}\"`;

  //   const child = exec(cmd)
  //   await new Promise((resolve) => {
  //     child.on('close', resolve)
  //   });
    
  //   if (!existsSync(imagePath)) {
  //     throw Error("File not found")
  //   }  
  //   return imagePath;
  // }

  deleteImageDir(imagePath: string){
    const dirPath = path.join(imagePath, '../')
    rmSync(dirPath, {force: true, recursive: true})

  }
}
