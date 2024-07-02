import pm2 from 'pm2'
import type { StartOptions } from 'pm2'

export function pm2Connect() {
    return new Promise((resolve, reject) => {
        pm2.connect(false,(err)=>{
            if(err){
                return reject(err)
            }
            return resolve(true)
        })
    })
}

export function pm2Delete(name: string) {
    return new Promise((resolve, reject) => {
        pm2.delete(name,(err, apps)=>{
            if(err){
                return reject(err)
            }
            return resolve(apps)
        })
    })
}

export function pm2List() {
    return new Promise((resolve, reject) => {
        pm2.list((err, list)=>{
            if(err){
                return reject(err)
            }
            return resolve(list)
        })
    })
}

export function pm2Start(options: StartOptions) {
    return new Promise((resolve, reject) => {
        pm2.start(options,(err, apps)=>{
            if(err){
                return reject(err)
            }
            return resolve(apps)
        })
    })
}

export function pm2Restart(name: string) {
    return new Promise((resolve, reject) => {
        pm2.restart(name, (err, apps)=>{
            if(err){
                return reject(err)
            }
            return resolve(apps)
        })
    })
}

export function pm2Reload(name: string) {
    return new Promise((resolve, reject) => {
        pm2.reload(name, (err, apps)=>{
            if(err){
                return reject(err)
            }
            return resolve(apps)
        })
    })
}

export function pm2Describe(name: string) {
    return new Promise((resolve, reject) => {
        pm2.describe(name, (err, apps)=>{
            if(err){
                return reject(err)
            }
            return resolve(apps)
        })
    })
}


export function pm2Stop(name: string) {
    return new Promise((resolve, reject) => {
        pm2.stop(name,(err, apps)=>{
            if(err){
                return reject(err)
            }
            return resolve(apps)
        })
    })
}